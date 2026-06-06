# Local Canvas LMS Setup

How to run **Canvas LMS on your machine** for EduAI development and testing.

This doc covers **installing and operating local Canvas only**. For connecting EduAI or Question Maker via API tokens, see [canvas-api-integration-guide.md](./implementations/canvas-api-integration-guide.md).


| Resource                       | Link                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Official Quick Start           | [canvas-lms Wiki — Quick Start](https://github.com/instructure/canvas-lms/wiki/Quick-Start) |
| Docker details                 | [canvas-lms/doc/docker](https://github.com/instructure/canvas-lms/tree/master/doc/docker)   |



---

## Overview

EduAI does **not** ship Canvas in this monorepo. Local Canvas comes from Instructure’s open-source [canvas-lms](https://github.com/instructure/canvas-lms) repo, run with Docker via `./script/docker_dev_setup.sh`.

The Quick Start environment is **development-only** (no production email, simplified jobs). Do not use it as a production instance.

---

## Requirements

Instructure recommends for `docker_dev_setup.sh`:


| Resource | Minimum      |
| -------- | ------------ |
| Disk     | ~150 GB free |
| RAM      | 8 GB         |
| CPU      | Quad-core    |


First run can take a long time (image builds, database setup, asset compilation).

---

## Platform setup

Canvas Quick Start uses Docker on **macOS**, **Linux (Ubuntu)**, or **Windows (via WSL 2)**. After your platform is ready, continue to [Install Canvas](#install-canvas) — the clone and `./script/docker_dev_setup.sh` steps are the same.

### Windows: WSL 2 + Docker Desktop

On Windows, run Canvas inside **WSL 2** with **Docker Desktop** WSL integration — not in PowerShell directly.

1. Install **WSL 2** with an **Ubuntu** distribution (e.g. Ubuntu 22.04 LTS).
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows.
3. Enable WSL integration:
   - Docker Desktop → **Settings** → **Resources** → **WSL Integration**
   - Turn on integration for your **Ubuntu** distro
   - Apply & restart if prompted
4. Open **Ubuntu** (Start menu or `wsl` in PowerShell) and verify Docker:

```bash
docker --version
docker compose version
```

All Canvas commands on Windows run **inside the Ubuntu WSL shell**.

**Clone location:** use your WSL home directory (`~`), not a Windows path under `/mnt/c/`. Docker and Canvas builds are much slower and often hit permission errors on `/mnt/c/Users/...`.

```bash
cd ~
pwd   # e.g. /home/yourname — this is where the clone should live
```

Recommended layout on Windows:

```text
~/canvas-lms/    ← clone here (WSL filesystem)
```

Avoid:

```text
/mnt/c/Users/you/canvas-lms/    ← Windows drive mount; slow, fragile permissions
```

**Windows-only setup failure:** if the script fails a Docker daemon check in WSL even when Docker Desktop is running:

```bash
sed -i 's/start_docker_daemon/true #start_docker_daemon/' script/common/os/linux/dev_setup.sh
./script/docker_dev_setup.sh
```

### Linux (Ubuntu)

Instructure’s automated script targets **Ubuntu** (tested on LTS releases such as 20.04 and 22.04). Other distros may work with Docker installed, but Ubuntu is the path of least resistance.

1. Install Docker and Compose — either:
   - [Docker Desktop for Linux](https://docs.docker.com/desktop/setup/install/linux/), or
   - [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) + the [Compose plugin](https://docs.docker.com/compose/install/linux/)
2. If using Docker Engine (not Desktop), add your user to the `docker` group and re-login:

```bash
sudo usermod -aG docker "$USER"
# log out and back in, then:
docker compose version
```

3. Clone and run the setup script from a normal terminal (see [Install Canvas](#install-canvas)).

Native Linux does **not** need the WSL daemon-check workaround above. BuildKit and `Gemfile.lock` fixes in [Setup failures](#setup-failures) still apply if you hit those errors.

### macOS

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) (Apple Silicon and Intel are both supported).
2. Start Docker Desktop and wait until it reports **Running**.
3. Open **Terminal** and verify:

```bash
docker --version
docker compose version
```

4. Clone and run the setup script (see [Install Canvas](#install-canvas)).

**Tips:**

- Allocate enough resources in Docker Desktop → **Settings** → **Resources** (Instructure recommends **8 GB RAM** and substantial disk; first build is large).
- On Apple Silicon, Canvas images build for `linux/amd64` in some setups — first run may be slower; let the script finish.
- If the setup script fails with Docker file permission / BuildKit errors, use the [BuildKit workaround](#setup-failures) before retrying.

---

## Install Canvas

From a terminal (WSL Ubuntu on Windows, native Linux, or macOS Terminal).

**Windows (WSL):** start in your home directory:

```bash
cd ~
git clone https://github.com/instructure/canvas-lms.git
cd canvas-lms

./script/docker_dev_setup.sh
```

**Linux / macOS:**

```bash
git clone https://github.com/instructure/canvas-lms.git
cd canvas-lms

./script/docker_dev_setup.sh
```

The script builds images, starts Compose services, and runs initial database setup. Follow prompts (admin email and password during `db:initial_setup`).

> If the script asks to recreate or overwrite `docker-compose.override.yml`, answer **n**. You will add port mappings in the next section; recreating that file wipes them.

### Setup failures

**Docker BuildKit / file permission errors** ([Quick Start](https://github.com/instructure/canvas-lms/wiki/Quick-Start)):

```bash
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0
./script/docker_dev_setup.sh
```

Use these exports only if you hit that class of failure.

**Permission error on `Gemfile.lock`:**

```bash
sudo chmod -R 777 ~/canvas-lms/
./script/docker_dev_setup.sh
```

---

## Host port mapping

Canvas serves on port **80 inside the container**. Map it to a **host port** in `canvas-lms/docker-compose.override.yml`:

```yaml
web:
  ports:
    - "8080:80"
```


| Part          | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `8080` (left) | Port on your machine — use this in the browser |
| `80` (right)  | Port inside the container — leave as `80`      |


Pick any free host port (`8888:80`, `3001:80`, etc.).

**Port conflict with EduAI Core:** Core defaults to host port **3000**. If you run Core and Canvas together, map Canvas to something else (e.g. **8080**):

- Canvas → `http://localhost:8080`
- EduAI Core → `http://localhost:3000`

Canvas-only testing (Core not running) can use `3000:80` instead:

```yaml
web:
  ports:
    - "3000:80"
```

After editing `docker-compose.override.yml`:

```bash
cd ~/canvas-lms
docker compose up -d
# or: docker compose up   (foreground — useful for first-boot logs)
```

Confirm in a browser: `http://localhost:8080/` (or your chosen port).

---

## First login

1. Open `http://localhost:<HOST_PORT>/`.
2. Log in with the **admin credentials** from `docker_dev_setup.sh`.
3. You now have a working local Canvas instance.

To add test users and courses manually: **Admin** → create users/courses, or use **People** on a course to enroll students.

---

## Create an API access token

Needed for API testing or the seed script (admin token).

1. Log in (admin or instructor).
2. **Account** → **Settings**.
3. **Approved Integrations** → **+ New Access Token**.
4. Purpose: e.g. `local dev`.
5. **Generate Token** → copy immediately (shown once).

Format example: `1234~AbCdEf...`

Do not commit tokens. Revoke in Canvas if leaked.

---

## Verify Canvas is running

Replace `8080` with your mapped host port throughout this section.

### Browser (all platforms)

Open `http://localhost:8080/` — you should see the Canvas login page. Log in with the admin account from `docker_dev_setup.sh`.

### Docker services (Linux, macOS, WSL)

From your `canvas-lms` clone:

```bash
cd ~/canvas-lms
docker compose ps
```

The `web` service should be **running**. If not:

```bash
docker compose up -d
docker compose logs -f web   # watch for errors
```

### API check — Linux

In any terminal (native Ubuntu, etc.):

```bash
# No token: expect HTTP 401 or a redirect — confirms something is listening
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/api/v1/courses"

# With token (create one first — see section above)
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8080/api/v1/users/self/profile"
```

A successful profile call returns JSON with your user `name`, `id`, etc.

### API check — macOS

Same as Linux — use **Terminal**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/api/v1/courses"

curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8080/api/v1/users/self/profile"
```

If `curl` is missing, install Xcode Command Line Tools: `xcode-select --install`.

### API check — Windows (WSL or PowerShell)

**WSL / Ubuntu** (same commands as Linux):

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8080/api/v1/users/self/profile"
```

**PowerShell** — use `curl.exe`, not `curl` (which aliases to `Invoke-WebRequest`):

```powershell
curl.exe -s -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:8080/api/v1/users/self/profile"
```

Or:

```powershell
$h = @{ Authorization = "Bearer YOUR_TOKEN" }
Invoke-RestMethod "http://localhost:8080/api/v1/users/self/profile" -Headers $h
```

---

## Day-to-day Docker commands

From your `canvas-lms` clone:

```bash
cd ~/canvas-lms

docker compose ps              # service status
docker compose logs -f web     # web container logs
docker compose up -d           # start in background
docker compose down            # stop all services
```

More detail: [canvas-lms/doc/docker](https://github.com/instructure/canvas-lms/tree/master/doc/docker).

---

## Troubleshooting


| Symptom                          | Likely cause                          | Fix                                                              |
| -------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `Connection refused` in browser  | Canvas not running or wrong port      | `docker compose ps`; check `docker-compose.override.yml` mapping |
| `permission denied` on `docker` (Linux) | User not in `docker` group     | `sudo usermod -aG docker $USER`; log out and back in             |
| Setup script BuildKit errors     | Docker BuildKit on some setups        | `export DOCKER_BUILDKIT=0` and retry (see above)                 |
| Daemon check fails in WSL        | Docker Desktop integration            | Enable WSL integration; try WSL `dev_setup.sh` sed patch         |
| `Gemfile.lock` permission denied | File ownership or clone on `/mnt/c/` | Use `~/canvas-lms` on WSL; `sudo chmod -R 777 ~/canvas-lms/` and retry |
| Slow build / I/O errors on WSL   | Repo cloned under `/mnt/c/...`       | Move or re-clone to `~/canvas-lms` inside WSL                          |
| Port already in use              | Another app on same host port         | Change left side of mapping (e.g. `8080:80` → `8888:80`)         |
| Core + Canvas both fail on 3000  | Port conflict                         | Map Canvas to 8080 (or another free port)                        |
| PowerShell `curl` behaves oddly  | `curl` aliases to `Invoke-WebRequest` | Use `curl.exe` or `Invoke-RestMethod` (Windows only)           |


---

## Checklist

- [ ] Platform ready: WSL + Docker Desktop (Windows), Docker Desktop or Engine (Linux), or Docker Desktop (macOS)
- [ ] **Windows:** repo cloned under WSL `~/canvas-lms` (not `/mnt/c/...`)
- [ ] `docker compose version` works in your terminal
- [ ] `git clone` + `./script/docker_dev_setup.sh` completed
- [ ] `docker-compose.override.yml` sets host port (e.g. `8080:80`)
- [ ] Canvas loads in browser; admin login works

