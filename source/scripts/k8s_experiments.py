#!/usr/bin/env python3
"""Availability experiments on Kubernetes, each one run under steady k6 traffic.

Prerequisites: DockMart is deployed, metrics-server is installed, and the `load-tests`
               ConfigMap exists (README).
Usage:         python scripts/k8s_experiments.py [results/k8s-experiments.json]

Experiments:   rolling update, rollback, pod deletion, liveness failure, node drain and
               autoscaling. Each records the k6 result and, where it helps, a timeline.
"""

import http.cookiejar
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

NAMESPACE = "dockmart"
ROOT = Path(__file__).resolve().parent.parent
K6_JOB = ROOT / "k8s" / "test-jobs" / "k6.yaml"
ADMIN_PASSWORD = (ROOT / "secrets" / "admin_password.txt").read_text().strip()
FORWARD_PORT = 18088
K6_LEAD_SECONDS = 10


def kubectl(*args, check=True):
    result = subprocess.run(
        ["kubectl", "-n", NAMESPACE, *args], capture_output=True, text=True, encoding="utf-8"
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"kubectl {' '.join(args)}: {result.stderr}")
    return result.stdout


def api_pods():
    return json.loads(kubectl("get", "pods", "-l", "app=api", "-o", "json"))["items"]


def snapshot(started):
    """One point of the timeline: how many pods run each version, and how many are ready."""
    versions, ready, terminating = {}, 0, 0
    for pod in api_pods():
        if pod["metadata"].get("deletionTimestamp"):
            terminating += 1
            continue
        tag = pod["spec"]["containers"][0]["image"].split(":")[-1]
        is_ready = any(
            c["type"] == "Ready" and c["status"] == "True" for c in pod["status"].get("conditions", [])
        )
        versions.setdefault(tag, {"total": 0, "ready": 0})
        versions[tag]["total"] += 1
        versions[tag]["ready"] += int(is_ready)
        ready += int(is_ready)
    return {"t": round(time.time() - started, 1), "versions": versions, "ready": ready, "terminating": terminating}


def start_k6(script="availability.js", duration="75s"):
    kubectl("delete", "job", "k6", "--ignore-not-found", "--wait=true")
    manifest = K6_JOB.read_text().replace("/scripts/availability.js", f"/scripts/{script}")
    manifest = manifest.replace('value: "75s"', f'value: "{duration}"')
    subprocess.run(["kubectl", "apply", "-f", "-"], input=manifest, text=True, check=True, capture_output=True)
    deadline = time.time() + 180
    while time.time() < deadline:
        phase = kubectl("get", "pods", "-l", "job-name=k6", "-o", "jsonpath={.items[0].status.phase}", check=False)
        if phase == "Running":
            return
        time.sleep(1)
    raise RuntimeError("k6 pod did not start")


def finish_k6():
    kubectl("wait", "--for=condition=complete", "job/k6", "--timeout=180s")
    for line in kubectl("logs", "job/k6").splitlines():
        if line.startswith("RESULT "):
            return json.loads(line[len("RESULT "):])
    raise RuntimeError("k6 printed no result")


def wait_until(condition, timeout=150, started=None, timeline=None):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if timeline is not None:
            timeline.append(snapshot(started))
        if condition():
            return True
        time.sleep(1)
    return False


def rollout_done():
    pods = [p for p in api_pods() if not p["metadata"].get("deletionTimestamp")]
    images = {p["spec"]["containers"][0]["image"] for p in pods}
    deployment = json.loads(kubectl("get", "deploy", "api", "-o", "json"))
    wanted = deployment["spec"]["template"]["spec"]["containers"][0]["image"]
    status = deployment["status"]
    return (
        images == {wanted}
        and status.get("updatedReplicas") == deployment["spec"]["replicas"]
        and status.get("readyReplicas") == deployment["spec"]["replicas"]
        and status.get("replicas") == deployment["spec"]["replicas"]
    )


def run_rollout(name, change):
    print(f"== {name}", flush=True)
    start_k6()
    time.sleep(K6_LEAD_SECONDS)
    started = time.time()
    timeline = []
    change()
    time.sleep(1)
    finished = wait_until(rollout_done, started=started, timeline=timeline)
    seconds = round(time.time() - started, 1)
    result = finish_k6()
    print(f"   {seconds}s, k6: {result}", flush=True)
    return {"finished": finished, "seconds": seconds, "k6": result, "timeline": timeline}


def experiment_rolling_update():
    return run_rollout(
        "rolling update 1.0.0 to 1.1.0",
        lambda: kubectl("set", "image", "deploy/api", "api=dockmart/backend:1.1.0"),
    )


def experiment_rollback():
    return run_rollout("rollback", lambda: kubectl("rollout", "undo", "deploy/api"))


def experiment_pod_delete():
    print("== pod deletion", flush=True)
    start_k6()
    time.sleep(K6_LEAD_SECONDS)
    victim = api_pods()[0]["metadata"]["name"]
    started = time.time()
    kubectl("delete", "pod", victim, "--wait=false")

    def replaced():
        pods = [p for p in api_pods() if not p["metadata"].get("deletionTimestamp")]
        ready = [
            p for p in pods
            if any(c["type"] == "Ready" and c["status"] == "True" for c in p["status"].get("conditions", []))
        ]
        return len(ready) == 3 and victim not in [p["metadata"]["name"] for p in ready]

    wait_until(replaced)
    seconds = round(time.time() - started, 1)
    result = finish_k6()
    print(f"   replacement ready after {seconds}s, k6: {result}", flush=True)
    return {"pod": victim, "seconds": seconds, "k6": result}


def experiment_liveness():
    print("== liveness failure", flush=True)
    forward = subprocess.Popen(
        ["kubectl", "-n", NAMESPACE, "port-forward", "svc/gateway", f"{FORWARD_PORT}:8080"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(3)
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

        def post(path, body):
            request = urllib.request.Request(
                f"http://127.0.0.1:{FORWARD_PORT}/api{path}",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
            )
            opener.open(request, timeout=10).read()

        post("/auth/login", {"email": "admin@dockmart.local", "password": ADMIN_PASSWORD})
        start_k6()
        time.sleep(K6_LEAD_SECONDS)
        pod = api_pods()[0]
        name = pod["metadata"]["name"]
        before = pod["status"]["containerStatuses"][0]["restartCount"]
        started = time.time()
        post("/ops/chaos", {"action": "unhealthy", "target": name})

        def restarted():
            current = json.loads(kubectl("get", "pod", name, "-o", "json"))
            return current["status"]["containerStatuses"][0]["restartCount"] > before

        wait_until(restarted)
        restart_seconds = round(time.time() - started, 1)
        wait_until(lambda: any(
            c["type"] == "Ready" and c["status"] == "True"
            for c in json.loads(kubectl("get", "pod", name, "-o", "json"))["status"]["conditions"]
        ))
        ready_seconds = round(time.time() - started, 1)
        result = finish_k6()
        print(f"   restart after {restart_seconds}s, ready after {ready_seconds}s, k6: {result}", flush=True)
        return {"pod": name, "restartSeconds": restart_seconds, "readySeconds": ready_seconds, "k6": result}
    finally:
        forward.terminate()


def experiment_autoscaling():
    """Heavy CPU load for two minutes, then none, while recording what the HPA decides."""
    print("== autoscaling", flush=True)
    start_k6("scale.js", "120s")
    started = time.time()
    timeline = []
    load_finished = None
    result = None
    while time.time() - started < 260:
        hpa = json.loads(kubectl("get", "hpa", "api", "-o", "json"))
        metrics = hpa["status"].get("currentMetrics") or [{}]
        current = metrics[0].get("resource", {}).get("current", {})
        ready = sum(
            any(c["type"] == "Ready" and c["status"] == "True" for c in p["status"].get("conditions", []))
            for p in api_pods() if not p["metadata"].get("deletionTimestamp")
        )
        timeline.append({
            "t": round(time.time() - started, 1),
            "desired": hpa["status"].get("desiredReplicas"),
            "current": hpa["status"].get("currentReplicas"),
            "ready": ready,
            "cpuPercent": current.get("averageUtilization"),
        })
        if load_finished is None and kubectl(
            "get", "job", "k6", "-o", "jsonpath={.status.succeeded}", check=False
        ).strip() == "1":
            load_finished = round(time.time() - started, 1)
            result = finish_k6()
        time.sleep(5)
    peak = max(point["current"] or 0 for point in timeline)
    print(f"   peak {peak} replicas, final {timeline[-1]['current']}, load ended at {load_finished}s, k6: {result}", flush=True)
    return {"peak": peak, "loadFinishedSeconds": load_finished, "k6": result, "timeline": timeline}


def experiment_drain():
    print("== node drain", flush=True)
    start_k6()
    time.sleep(K6_LEAD_SECONDS)
    # Choose a worker that does not hold the Postgres or Redis volumes.
    data_nodes = {p["spec"]["nodeName"] for p in json.loads(kubectl("get", "pods", "-l", "tier=data", "-o", "json"))["items"]}
    nodes = json.loads(subprocess.run(["kubectl", "get", "nodes", "-o", "json"], capture_output=True, text=True, check=True).stdout)
    workers = [
        n["metadata"]["name"] for n in nodes["items"]
        if "node-role.kubernetes.io/control-plane" not in n["metadata"]["labels"]
    ]
    target = next((name for name in workers if name not in data_nodes), workers[-1])
    started = time.time()
    drained = subprocess.run(
        ["kubectl", "drain", target, "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=120s"],
        capture_output=True, text=True,
    )
    seconds = round(time.time() - started, 1)
    placement = kubectl("get", "pods", "-l", "app=api", "-o", "custom-columns=POD:.metadata.name,NODE:.spec.nodeName")
    subprocess.run(["kubectl", "uncordon", target], check=True, capture_output=True)
    result = finish_k6()
    print(f"   drained {target} in {seconds}s (exit {drained.returncode}), k6: {result}", flush=True)
    print(placement, flush=True)
    return {"node": target, "seconds": seconds, "exit": drained.returncode, "placement": placement, "k6": result}


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "results" / "k8s-experiments.json"
    output.parent.mkdir(exist_ok=True)
    results = {}
    for key, experiment in [
        ("rollingUpdate", experiment_rolling_update),
        ("rollback", experiment_rollback),
        ("podDelete", experiment_pod_delete),
        ("liveness", experiment_liveness),
        ("drain", experiment_drain),
        ("autoscaling", experiment_autoscaling),
    ]:
        results[key] = experiment()
        output.write_text(json.dumps(results, indent=2))
        time.sleep(8)
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
