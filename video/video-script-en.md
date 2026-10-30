# Video presentation script (English version)

Topic: Containers in Web Development and Deployment (Docker). Course 503073, Web Programming & Applications.

This is the English version. The Vietnamese version, `video-script-vi.md`, has the same content in the same order. You do not need to memorise every word: say it in your own words, and keep the meaning and the figures exact.

Planned length: about 18 minutes (the limit is 20), shared equally. The brief requires every member to appear in the video.

| Time | Content | Speaker |
|---|---|---|
| 0:00 | Opening and why this topic | Hiếu |
| 1:30 | How containers work | Hiếu |
| 4:30 | Images, layers, multi-stage builds | Hiếu |
| 6:00 | Containers, VMs, Compose, Kubernetes compared | Huy |
| 8:00 | DockMart architecture | Huy |
| 9:30 | Demo 1: start the system, buy something | Huy |
| 11:30 | Demo 2: scaling, load balancing, killing a container | Hiếu |
| 13:30 | Demo 3: persistence and security | Huy |
| 14:30 | Demo 4: Kubernetes | Hiếu |
| 16:30 | Measured results | Huy |
| 17:30 | Conclusion | Both |

## Before recording

1. Open Docker Desktop. Turn on Kubernetes for Demo 4 (Settings → Kubernetes, kind, 3 nodes).
2. In the `source` folder, run these first so that nothing downloads during the recording:
   `docker compose --profile monitoring pull`, then `docker compose build`.
3. Delete old data so that orders start from number 1: `docker compose --profile monitoring down -v`.
4. Open a terminal (with a large font), the browser and the slides. Turn off Zalo and Discord notifications.
5. Admin account: `admin@dockmart.local` / `DockMart-Admin-2026`.
6. Record one test minute and check the sound. Poor audio or video loses points.

---

## 0:00 Opening (Hiếu)

**On screen:** title slide, both cameras on.

> Hello, we are Trần Trung Hiếu and Nguyễn Đức Nhật Huy, and this is our midterm essay for Web Programming and Applications, instructed by Mr. Nguyễn Thái Duy. Our topic is containers in web development and deployment, with Docker.
>
> Every developer has heard the sentence "it works on my machine". The code is fine, but the environment around it is different. Containers solve this by packaging the application with everything it needs. Today this is mainstream. In the 2025 Stack Overflow survey, 71 percent of respondents said they use Docker.
>
> In this video we will explain how containers actually work, compare them with the alternatives, and then show you DockMart, the system we built to test these ideas. We did not only build it. We broke it on purpose and measured what happened.

## 1:30 How containers work (Hiếu)

**On screen:** timeline slide, then the namespace and cgroup slide.

> Containers are older than Docker. Unix had chroot in 1979, and FreeBSD had Jails in 2000. What Docker added in 2013 was not new isolation. It was a simple way to package an application and share it.
>
> The most important thing to understand is that a container is not a small virtual machine. It is a normal Linux process, and the kernel treats it specially in two ways.
>
> First, namespaces control what a process can see. In its own PID namespace, the process believes it is process number one. In its own network namespace, it has its own IP address, so two containers can both use port 8080.
>
> Second, control groups limit what a process can use. Our API containers can use at most half a CPU core and 256 megabytes of memory. If one replica leaks memory, the kernel stops that replica, not the whole server.
>
> Because there is no guest operating system, containers start quickly and use little memory. But it also means all containers share one kernel, so isolation is weaker than in a virtual machine. We will come back to that when we talk about security.

## 4:30 Images, layers, multi-stage builds (Hiếu)

**On screen:** layer slide, then `backend/Dockerfile` in VS Code.

> An image is a stack of read-only layers. When a container starts, Docker adds one thin writable layer on top. So three replicas of our API share one copy of the image on disk.
>
> Layers also explain the build cache. In our Dockerfile, we copy the package files first and install dependencies, and only then copy the source code. If we change one line of code, the dependency layers come from the cache.
>
> We also use a multi-stage build. One file has four targets: development, test, build, and production. The test stage runs our linter and unit tests during the build, so an image that fails its tests cannot even be created. The final stage contains only what is needed to run, and it runs as a normal user, not root.
>
> We compared this with the kind of Dockerfile many tutorials show. The simple version was 1,718 megabytes with 57 critical vulnerabilities. Ours is 288 megabytes with 0 critical vulnerabilities.

## 6:00 Comparison (Huy)

**On screen:** VM and container slide, then the orchestrator comparison table.

> Now let me compare containers with the alternatives. A virtual machine virtualises hardware, so each one boots a full guest kernel. A container shares the host kernel. So containers are lighter and faster, while virtual machines give stronger isolation. In practice they work together: clouds usually run containers inside virtual machines.
>
> The second comparison is about orchestration. Docker Compose runs a whole application on one host. It is simple, and it is enough for many small sites. But if that host fails, everything fails. Kubernetes runs across many machines. You declare the state you want, for example three replicas of version 1.1, and controllers keep making reality match. It gives you rolling updates and autoscaling, but it costs a lot more to learn and to run.
>
> So Kubernetes is not automatically the right answer. A small store would be fine on Compose. We built both, so that we could measure the difference.

## 8:00 DockMart architecture (Huy)

**On screen:** architecture slide.

> This is DockMart, an online store with seven kinds of container. The browser only reaches the gateway, which is Nginx. It sends pages to the web container and API calls to one of three API replicas. Orders go into a queue in Redis, and worker containers process them in the background. Data lives in PostgreSQL, on a named volume.
>
> Two design decisions matter most. First, the API is stateless. Sessions are signed tokens, and the cache and the queue live in Redis, so any replica can serve any request. That is what makes it safe to scale. Second, the databases sit on an internal network. The gateway has no route to them at all.
>
> Let me show you how it runs.

## 9:30 Demo 1: start the system, buy something (Huy)

**On screen:** terminal and browser.

Steps:

1. Run `docker compose up -d --build --wait`.
2. Run `docker compose ps`.
3. Open `http://localhost:8080`, create an account, add 2 products and place an order.
4. On **My orders**, let the audience watch the status change by itself.

> One command starts the whole system, and Docker is the only thing installed on this machine. Compose starts services in the right order, based on health checks. PostgreSQL and Redis become healthy first, then a one-shot container migrates the database, then the API starts, and the gateway comes last.
>
> Here is the store. I will create an account, add some products and place an order. Watch the status. I did not reload the page. A worker container is processing the order, and each step reaches my browser through Redis and a Server-Sent Events connection. The last line shows which worker handled it.

## 11:30 Demo 2: scaling, load balancing, killing a container (Hiếu)

**On screen:** sign in as admin, open **Ops Center**, split the screen with a terminal.

Steps:

1. Press **Send 300 requests**.
2. Run `docker compose up -d --scale api=5 --no-recreate`, wait for 2 new cards, then press **Send 300 requests** again.
3. Press **Kill** on an API card.
4. Point out that `Uptime` returns to zero and `Restarts` rises by 1 on that card.

> This is the Ops Center. Each card is a running replica, reporting to Redis every two seconds. I will send 300 requests through the gateway. The bars show them spread evenly across the three replicas.
>
> Now I scale to five replicas with one command, while the site is running. Two new cards appear. I send the requests again, and now five replicas share the load. I did not touch the gateway. Nginx re-reads DNS, so it finds new replicas by itself.
>
> Now let's break something. I press Kill. That process really crashes, and Docker's restart policy brings it back within seconds. Watch this card: the uptime goes back to zero and the restart counter goes up by one, and the event log records the crash. In our test, 0 of 4,001 requests failed during a crash, because the gateway retries on another replica.
>
> One thing we learned: if you run docker kill by hand, Docker treats that as your decision, and the restart policy does not bring it back. A restart policy is for failures.

## 13:30 Demo 3: persistence and security (Huy)

**On screen:** terminal.

Steps:

1. `docker compose rm -sf postgres`, then `docker compose up -d postgres`.
2. Reload **My orders**: the order is still there.
3. `docker compose exec gateway nc -z -w2 postgres 5432` reports `bad address`.
4. `docker compose exec api sh -c 'id; touch /app/x; grep CapEff /proc/1/status'`.

> I just deleted the database container. I create a new one, reload the page, and the order is still there, because data lives in a volume and not in the container.
>
> Now security. From the gateway, I try to reach PostgreSQL, and the name does not even resolve. The networks keep them apart. Inside the API container, the user is not root, the filesystem is read-only, and the capability set is all zeros. So even if an attacker gets in, there is very little they can do.

## 14:30 Demo 4: Kubernetes (Hiếu)

**On screen:** terminal, starting with `kubectl -n dockmart get pods -o wide`.

Steps (deploy beforehand, following section 6 of the README):

1. `kubectl -n dockmart get pods -o wide`.
2. `kubectl -n dockmart set image deploy/api api=dockmart/backend:1.1.0`, then `kubectl -n dockmart get pods -w`.
3. `kubectl -n dockmart rollout undo deploy/api`.
4. If time allows: `kubectl -n dockmart get hpa`.

> The same images now run on a three-node Kubernetes cluster. No application code changed. Only the description of how to run it. Here you can see the pods spread across nodes.
>
> Now a rolling update to version 1.1. Kubernetes starts one new pod, waits until it is ready, and only then removes an old one. We ran this with 100 requests per second, and out of 7,500 requests, 0 failed. The update took 14.2 seconds. If the new version is bad, one command rolls it back.
>
> We also tested autoscaling. Under heavy load, Kubernetes went from three replicas to eight in about 60 seconds, and returned to three after the load stopped. On Compose, a person has to do that by hand.

## 16:30 Measured results (Huy)

**On screen:** chart slides.

> We measured everything we claimed. Throughput grew from 107 requests per second with one replica to 510 with six, which is 4.8 times more. The image became 6.0 times smaller, and the nine running containers used about 227 megabytes of memory when idle.
>
> Measuring also showed us our mistakes. Our first version hung when Redis stopped, a liveness failure lost two requests on Kubernetes, and a new Nginx default kept load on too few Pods. We found these problems only because we tested failure on purpose, and we fixed all of them. Now, when Redis is down, the catalog still works from PostgreSQL, and only checkout is refused, with a clear message.

## 17:30 Conclusion (Hiếu, then Huy)

**On screen:** conclusion slide, both cameras on.

**Hiếu:**

> To conclude, containers really do deliver portability, consistency and efficiency, but they do not design your application for you. Scaling worked because we made the API stateless. Zero downtime worked because we handled shutdown signals correctly.

**Huy:**

> And the right tool depends on the problem. Compose was enough for one host, and Kubernetes earned its complexity only when we needed updates without downtime and automatic scaling. In the future we would like to add HTTPS, a replicated database, and a real cloud deployment. Thank you for watching.

---

## After recording

Check that both members appear, the sound is clear, the length is under 20 minutes and the terminal text is readable. Export an MP4 and submit it with the report, source code and README as the instructor directs.
