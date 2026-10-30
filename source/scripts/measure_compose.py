#!/usr/bin/env python3
"""Measurements on Docker Compose behind the tables and charts in the report.

Usage: python scripts/measure_compose.py [images|startup|scale|resilience|network|all]
Output: results/*.json, one file per group. Docker is the only requirement.
"""

import http.cookiejar
import json
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
BASE_URL = "http://localhost:8080"
ADMIN_PASSWORD = (ROOT / "secrets" / "admin_password.txt").read_text().strip()

STRATEGIES = [
    ("naive", "experiments/Dockerfile.naive", None),
    ("slim", "experiments/Dockerfile.slim", None),
    ("distroless", "experiments/Dockerfile.distroless", None),
    ("multi-stage alpine", "backend/Dockerfile", "production"),
]


def run(*args, check=True, capture=True, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, capture_output=capture, text=True, encoding="utf-8", errors="replace")
    if check and result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def compose(*args, check=True):
    return run("docker", "compose", *args, check=check)


def save(name, data):
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(data, indent=2))
    print(f"saved results/{name}.json", flush=True)


def timed_build(dockerfile, context, tag, target=None, no_cache=False):
    args = ["docker", "build", "-q", "-f", str(dockerfile), "-t", tag]
    if target:
        args += ["--target", target]
    if no_cache:
        args.append("--no-cache")
    args.append(str(context))
    started = time.perf_counter()
    run(*args)
    return round(time.perf_counter() - started, 1)


def scan(tag, workdir):
    """Scans a saved image, so the scanner needs no access to the Docker socket."""
    tar = Path(workdir) / "image.tar"
    run("docker", "save", "-o", str(tar), tag)
    for attempt in range(3):
        result = subprocess.run(
            ["docker", "run", "--rm",
             "-v", f"{workdir}:/scan:ro",
             "-v", "dockmart-grype-db:/.cache/grype",
             "-e", "GRYPE_DB_CACHE_DIR=/.cache/grype",
             "anchore/grype:latest", "docker-archive:/scan/image.tar", "-o", "json", "--quiet"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode == 0:
            break
        print(f"   scan attempt {attempt + 1} failed with exit code {result.returncode}", flush=True)
        time.sleep(5)
    else:
        raise RuntimeError(f"grype failed for {tag}: {result.stderr}")
    output = result.stdout
    download_mb = round(tar.stat().st_size / 1_000_000, 1)
    tar.unlink()
    counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Negligible": 0, "Unknown": 0}
    for match in json.loads(output)["matches"]:
        counts[match["vulnerability"]["severity"]] += 1
    return counts, download_mb


def measure_images():
    results = []
    for name, dockerfile, target in STRATEGIES:
        print(f"== image: {name}", flush=True)
        tag = f"dockmart-experiment/{name.split()[0]}:latest"
        # The system temp folder, because images are too big for a synced project folder.
        with tempfile.TemporaryDirectory() as work:
            context = Path(work) / "context"
            shutil.copytree(ROOT / "backend", context)
            dockerfile_path = ROOT / dockerfile
            builds = [timed_build(dockerfile_path, context, tag, target, no_cache=True) for _ in range(3)]

            # The classic developer loop: one line of application code changes.
            with (context / "src" / "app.js").open("a") as source:
                source.write("\n// a one-line change\n")
            rebuild = timed_build(dockerfile_path, context, tag, target)

            info = json.loads(run("docker", "image", "inspect", tag))[0]
            shell = subprocess.run(["docker", "run", "--rm", "--entrypoint", "sh", tag, "-c", "true"], capture_output=True).returncode == 0
            uid = run("docker", "image", "inspect", "-f", "{{.Config.User}}", tag).strip() or "root"
            vulnerabilities, download_mb = scan(tag, str(Path(work).resolve()))
            results.append({
                "strategy": name,
                "coldBuildSeconds": statistics.median(builds),
                "rebuildSeconds": rebuild,
                "sizeMB": round(info["Size"] / 1_000_000, 1),
                "downloadMB": download_mb,
                "layers": len(info["RootFS"]["Layers"]),
                "user": uid,
                "hasShell": shell,
                "vulnerabilities": vulnerabilities,
            })
        print(f"   {results[-1]}", flush=True)
        save("images", results)


def wait_for_health(names, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        states = run("docker", "inspect", "-f", "{{.State.Health.Status}}", *names, check=False).split()
        if len(states) == len(names) and all(state == "healthy" for state in states):
            return True
        time.sleep(0.2)
    return False


def measure_startup():
    print("== container start overhead", flush=True)
    overhead = []
    for _ in range(10):
        started = time.perf_counter()
        run("docker", "run", "--rm", "alpine:3.24", "true")
        overhead.append(time.perf_counter() - started)

    print("== full stack cold start", flush=True)
    full = []
    for _ in range(3):
        compose("down")
        started = time.perf_counter()
        compose("up", "-d", "--wait")
        full.append(time.perf_counter() - started)

    print("== scale from 3 to 6 replicas", flush=True)
    scale = []
    for _ in range(3):
        compose("up", "-d", "--scale", "api=3", "--no-recreate", "--wait")
        started = time.perf_counter()
        compose("up", "-d", "--scale", "api=6", "--no-recreate", "--wait")
        scale.append(time.perf_counter() - started)
    compose("up", "-d", "--scale", "api=3", "--no-recreate", "--wait")

    stats = run("docker", "stats", "--no-stream", "--format", "{{json .}}")
    usage = [json.loads(line) for line in stats.splitlines() if "dockmart" in line]
    save("startup", {
        "containerRunSeconds": round(statistics.median(overhead), 3),
        "fullStackSeconds": round(statistics.median(full), 1),
        "scaleUpSeconds": round(statistics.median(scale), 1),
        "raw": {"overhead": overhead, "full": full, "scale": scale},
        "idleUsage": [{"name": u["Name"], "memory": u["MemUsage"], "cpu": u["CPUPerc"]} for u in usage],
    })


def k6(script, *env):
    args = ["docker", "compose", "--profile", "load", "run", "--rm", "--quiet-pull"]
    for item in env:
        args += ["-e", item]
    args += ["k6", "run", "--quiet", f"/scripts/{script}"]
    for line in run(*args).splitlines():
        if line.startswith("RESULT "):
            return json.loads(line[len("RESULT "):])
    raise RuntimeError("k6 printed no result")


def replicas_visible(count, timeout=30):
    """Waits until the gateway has actually started to use `count` replicas."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        seen = set()
        for _ in range(count * 8):
            with urllib.request.urlopen(f"{BASE_URL}/api/whoami", timeout=5) as response:
                seen.add(json.load(response)["instance"])
        if len(seen) == count:
            return True
        time.sleep(1)
    return False


def measure_scale(rounds=3):
    results = []
    for replicas in range(1, 7):
        compose("up", "-d", "--scale", f"api={replicas}", "--no-recreate", "--wait")
        time.sleep(6)
        if not replicas_visible(replicas):
            raise RuntimeError(f"gateway does not see {replicas} replicas")
        runs = [k6("scale.js", "DURATION=20s", "VUS=48") for _ in range(rounds)]
        results.append({
            "replicas": replicas,
            "rps": statistics.median(r["rps"] for r in runs),
            "p95Ms": statistics.median(r["p95Ms"] for r in runs),
            "failedRate": max(r["failedRate"] for r in runs),
            "runs": runs,
        })
        print(f"== replicas={replicas}: rps={results[-1]['rps']} p95={results[-1]['p95Ms']}", flush=True)
    compose("up", "-d", "--scale", "api=3", "--no-recreate", "--wait")
    save("scale", results)


class Session:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{BASE_URL}/api{path}", data=data, headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=15) as response:
                text = response.read()
                return response.status, dict(response.headers), json.loads(text) if text else None
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), json.loads(err.read() or b"{}")


def under_load(action):
    """Runs `action` ten seconds into 40 s of steady traffic and returns the k6 result."""
    process = subprocess.Popen(
        ["docker", "compose", "--profile", "load", "run", "--rm", "-e", "DURATION=40s", "-e", "RATE=100",
         "k6", "run", "--quiet", "/scripts/availability.js"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    time.sleep(10)
    detail = action()
    output, _ = process.communicate(timeout=120)
    line = next(l for l in output.splitlines() if l.startswith("RESULT "))
    return {"k6": json.loads(line[len("RESULT "):]), "detail": detail}


def replica_ids():
    names = compose("ps", "-q", "api").split()
    return {run("docker", "inspect", "-f", "{{.Config.Hostname}}", name).strip(): name for name in names}


def measure_resilience():
    admin = Session()
    assert admin.call("/auth/login", {"email": "admin@dockmart.local", "password": ADMIN_PASSWORD})[0] == 200
    results = {}

    print("== baseline", flush=True)
    results["baseline"] = under_load(lambda: None)

    def crash():
        hostname, container = next(iter(replica_ids().items()))
        admin.call("/ops/chaos", {"action": "crash", "target": hostname})
        started = time.perf_counter()
        deadline = time.time() + 30
        while time.time() < deadline:
            count = run("docker", "inspect", "-f", "{{.RestartCount}}", container).strip()
            if count != "0" or run("docker", "inspect", "-f", "{{.State.Running}}", container).strip() == "true" and time.perf_counter() - started > 1:
                break
            time.sleep(0.1)
        healthy = wait_for_health([container], timeout=30)
        return {"recoverySeconds": round(time.perf_counter() - started, 1), "healthy": healthy}

    print("== process crash, restart policy recovers it", flush=True)
    results["crash"] = under_load(crash)

    def graceful():
        _, container = next(iter(replica_ids().items()))
        started = time.perf_counter()
        run("docker", "stop", container)
        seconds = round(time.perf_counter() - started, 1)
        run("docker", "start", container)
        return {"stopSeconds": seconds}

    print("== graceful stop (SIGTERM)", flush=True)
    results["gracefulStop"] = under_load(graceful)
    time.sleep(8)

    def hard_kill():
        _, container = next(iter(replica_ids().items()))
        run("docker", "kill", "-s", "KILL", container)
        time.sleep(1)
        restarted = run("docker", "inspect", "-f", "{{.State.Status}}", container).strip()
        return {"statusAfterKill": restarted, "container": container}

    print("== docker kill, restart policy does not apply", flush=True)
    results["dockerKill"] = under_load(hard_kill)
    run("docker", "start", results["dockerKill"]["detail"]["container"])
    time.sleep(8)

    print("== worker dies in the middle of an order", flush=True)
    customer = Session()
    customer.call("/auth/register", {"name": "Measure", "email": f"m{int(time.time())}@example.com", "password": "correct horse battery"})
    status, _, data = customer.call("/orders", {"items": [{"productId": 12, "quantity": 1}]})
    assert status == 201, data
    order_id = data["order"]["id"]
    worker = None
    while worker is None:
        worker = customer.call(f"/orders/{order_id}")[2]["order"]["processedBy"]
        time.sleep(0.1)
    started = time.perf_counter()
    admin.call("/ops/chaos", {"action": "crash", "target": worker})
    while True:
        order = customer.call(f"/orders/{order_id}")[2]["order"]
        if order["status"] == "shipped" or time.perf_counter() - started > 60:
            break
        time.sleep(0.2)
    results["workerCrash"] = {
        "status": order["status"],
        "crashedWorker": worker,
        "finishedBy": order["processedBy"],
        "secondsAfterCrash": round(time.perf_counter() - started, 1),
    }
    print(f"   {results['workerCrash']}", flush=True)

    print("== Redis outage: degraded mode", flush=True)
    compose("stop", "redis")
    time.sleep(1)
    started = time.perf_counter()
    status, headers, data = customer.call("/products")
    read_ms = round((time.perf_counter() - started) * 1000)
    order_status = customer.call("/orders", {"items": [{"productId": 12, "quantity": 1}]})[0]
    login_status = customer.call("/auth/me")[0]
    compose("start", "redis")
    wait_for_health([run("docker", "compose", "ps", "-q", "redis").strip()])
    time.sleep(3)
    order_after = customer.call("/orders", {"items": [{"productId": 12, "quantity": 1}]})[0]
    results["redisOutage"] = {
        "catalogStatus": status,
        "catalogCacheHeader": headers.get("X-Cache"),
        "catalogMs": read_ms,
        "products": len(data["products"]),
        "sessionStatus": login_status,
        "orderDuringOutage": order_status,
        "orderAfterRecovery": order_after,
    }
    print(f"   {results['redisOutage']}", flush=True)
    save("resilience", results)


def measure_network():
    """Tests every source and destination, so the table in the report is measured."""
    services = ["gateway", "web", "api", "worker", "postgres", "redis"]
    ports = {"web": 8080, "api": 4000, "postgres": 5432, "redis": 6379}
    matrix = {}
    for source in services:
        matrix[source] = {}
        for target, port in ports.items():
            check = f"nc -z -w2 {target} {port}"
            matrix[source][target] = subprocess.run(
                ["docker", "compose", "exec", "-T", source, "sh", "-c", check], cwd=ROOT, capture_output=True
            ).returncode == 0
        internet = "wget -q -T 4 -O /dev/null http://example.com"
        matrix[source]["internet"] = subprocess.run(
            ["docker", "compose", "exec", "-T", source, "sh", "-c", internet], cwd=ROOT, capture_output=True
        ).returncode == 0
        print(f"   {source}: {matrix[source]}", flush=True)
    save("network", matrix)


def main():
    RESULTS.mkdir(exist_ok=True)
    groups = {
        "images": measure_images,
        "startup": measure_startup,
        "scale": measure_scale,
        "resilience": measure_resilience,
        "network": measure_network,
    }
    chosen = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, group in groups.items():
        if chosen in (name, "all"):
            group()


if __name__ == "__main__":
    main()
