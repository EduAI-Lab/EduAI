# Canvas API Key Integration Guide

**Issue:** EduAICore #379 (Epic #59)  
**Status:** Complete (June 2026)  
**Audience:** Developers integrating or testing Canvas via personal API token  

**Related docs:**


| Document                                                                                            | Purpose                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Canvas integration strategy](./lti-canvas-integration-report.md) | CWL-first product direction; LTI deferred |
| [Canvas LTI vs API research](./canvas-lti-vs-api-key-research.md)                                   | Endpoints, roster sync, local API test results |
| [Question Maker Canvas export](../../apps/extensions/question-maker/docs/features/CANVAS_EXPORT.md) | Instructor UI walkthrough for quiz export      |
| [Question Maker encryption](../../apps/extensions/question-maker/docs/features/ENCRYPTION.md)       | How API keys are stored                        |


---

## 1. What this guide covers

This guide documents **how to connect EduAI to Canvas using a personal API access token** (REST API), in two developer setups:


| Setup                                  | EduAI runs…                                     | Canvas runs…                                                                           |
| -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| **0. Canvas LMS (WSL + Docker)**       | —                                               | [canvas-lms](https://github.com/instructure/canvas-lms) via `docker_dev_setup.sh` (§4) |
| **A. Web / host (local npm)**          | On your machine (`npm run dev` or QM terminals) | Local Canvas (§4) or UBC Canvas                                                        |
| **B. Docker (Question Maker Compose)** | QM backend + frontend in containers             | Canvas on WSL/host (see §4.7)                                                          |


**Out of scope here:** LTI launch inside Canvas (see [lti-schema-changes.md](./lti-schema-changes.md)).  
**In scope:** Token creation, `canvasUrl`, server-side API calls, Question Maker connect/export, API verification, future Core roster sync.

---

## 2. How integration works (architecture)

```text
Instructor browser
    → Question Maker UI (connect: Canvas URL + token)
    → QM backend POST /api/canvas/connect
    → Encrypt token → canvas_integrations table
    → Later: QM backend calls {canvasUrl}/api/v1/... with Authorization: Bearer {token}
    → Canvas LMS
```

- The token never goes to the browser after save (only `canvasUrl`, `isTestMode`, `isConnected`).
- All Canvas calls are **server-to-server** from the QM backend (or future Core service).
- `**canvasUrl`** must be the Canvas **site root** with no trailing slash, e.g. `http://localhost:8080` (local) or `https://canvas.ubc.ca` — not `/api/v1`.

**Implemented today (Question Maker):**


| Endpoint                        | Purpose                         |
| ------------------------------- | ------------------------------- |
| `GET /api/canvas/integration`   | Connection status               |
| `POST /api/canvas/connect`      | Save URL + token (or test mode) |
| `DELETE /api/canvas/disconnect` | Remove integration              |
| `GET /api/canvas/courses`       | Teacher courses                 |
| Export/import routes            | Quizzes (see `canvas.js`)       |


**Planned (Core):** Roster sync using same token pattern — see [strategy report](./lti-canvas-integration-report.md) §4.

---

## 3. Prerequisites

### 3.1 Canvas

- A Canvas instance you can log into (local LMS, sandbox, or `https://canvas.ubc.ca`).
- A user enrolled as **Teacher** on at least one course (for course list + roster/quiz APIs).
- Ability to create **Approved Integrations** access token (Settings → New Access Token).

### 3.2 EduAI / Question Maker

- Monorepo cloned; `npm install` at `EduAICore` root.
- PostgreSQL for Question Maker (monorepo `docker:dev:db` or QM `docker-compose.dev.yml`).
- `ENCRYPTION_KEY` in Question Maker `.env` (64-char hex) — required for storing tokens. See [ENCRYPTION.md](../../apps/extensions/question-maker/docs/features/ENCRYPTION.md).

### 3.3 Port conflict warning

**EduAI Core** and Canvas Quick Start both *can* use host port **3000**. The usual fix is to map Canvas to another host port in `docker-compose.override.yml` (e.g. `**8080:80`**) — see §4.4. Then Core stays on 3000 and Canvas on 8080.


| Service                       | Default port                   |
| ----------------------------- | ------------------------------ |
| EduAI Core                    | 3000                           |
| Question Maker API            | 8000                           |
| Question Maker UI             | 5173                           |
| Canvas LMS (inside container) | 80 → map to host e.g. **8080** |


Use whatever host port loads Canvas in your browser as `canvasUrl`.

---

## 4. Run Canvas LMS locally (Docker + WSL)

EduAI does **not** ship Canvas in this monorepo. For local development, use Instructure’s official **Quick Start** flow with Docker.

**Upstream guide:** [Canvas LMS Wiki — Quick Start](https://github.com/instructure/canvas-lms/wiki/Quick-Start)  
**More Docker detail:** [canvas-lms/doc/docker](https://github.com/instructure/canvas-lms/tree/master/doc/docker)

The environment produced by Quick Start is **development-only** (no production email, simplified job processing, etc.). Do not use it as a production Canvas instance.

### 4.1 Requirements (from Quick Start)

Instructure recommends for `docker_dev_setup.sh`:


| Resource | Minimum      |
| -------- | ------------ |
| Disk     | ~150 GB free |
| RAM      | 8 GB         |
| CPU      | Quad-core    |


First run can take a long time (image builds, DB setup, asset compilation).

### 4.2 Windows: WSL 2 + Docker Desktop

On Windows, run Canvas inside **WSL 2** and use **Docker Desktop** with WSL integration.

1. **Install WSL 2** with an **Ubuntu** distribution (e.g. Ubuntu 22.04 LTS) if not already installed.
2. **Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)** on Windows.
3. **Enable WSL integration for Ubuntu:**
  - Docker Desktop → **Settings** → **Resources** → **WSL Integration**
  - Turn on integration for your **Ubuntu** distro
  - Apply & restart if prompted
4. Open **Ubuntu** from the Start menu (or `wsl` in PowerShell) and confirm Docker works:

```bash
docker --version
docker compose version
```

All `git clone` and `./script/docker_dev_setup.sh` steps below should run **inside this Ubuntu WSL shell**, not in PowerShell (unless you use WSL explicitly: `wsl -d Ubuntu`).

### 4.3 Clone Canvas LMS and run automated Docker setup

In your **WSL Ubuntu** terminal (e.g. home directory):

```bash
git clone https://github.com/instructure/canvas-lms.git
cd canvas-lms

./script/docker_dev_setup.sh
```

The script builds images, starts Compose services, and performs initial Canvas setup. Follow any prompts (e.g. admin email/password during `db:initial_setup`).

> **Note:** If the script asks whether to recreate or overwrite `docker-compose.override.yml`, answer **n**. That file is created during setup; recreating it will wipe port mappings you add in §4.4.

**If the script fails with Docker file permission / BuildKit errors** (per [Quick Start](https://github.com/instructure/canvas-lms/wiki/Quick-Start)):

```bash
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0
./script/docker_dev_setup.sh
```

Only use those exports if you hit that class of failure.

**If the script fails a Docker daemon check in WSL** even when Docker Desktop is running:

```bash
sed -i 's/start_docker_daemon/true #start_docker_daemon/' script/common/os/linux/dev_setup.sh
./script/docker_dev_setup.sh
```

**If you get a permission error on `Gemfile.lock`:**

```bash
sudo chmod -R 777 ~/canvas-lms/
./script/docker_dev_setup.sh
```

### 4.4 Expose Canvas on a host port (and avoid conflict with EduAI Core)

Canvas Quick Start runs the web app **inside** the container on port **80**. You choose the **host** port with Docker Compose port mapping: `"HOST:CONTAINER"`.

In `canvas-lms/docker-compose.override.yml`, under the `web:` service, set `ports`:

```yaml
web:
  ports:
    - "8080:80"
```


| Mapping       | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `8080` (left) | Port on your machine / WSL — use this in the browser and as `canvasUrl` |
| `80` (right)  | Port inside the Canvas container — leave as `80`                        |


**Yes — map Canvas to a different host port** so it does not clash with EduAI Core on **3000**. Recommended when running both:

- **Canvas:** `http://localhost:8080` → `canvasUrl` = `http://localhost:8080`
- **EduAI Core:** `http://localhost:3000` (default in monorepo)

You can use any free host port (e.g. `8888:80`, `3001:80`). Only the **left** number must not be in use.

Example for default Canvas on 3000 (QM-only testing, Core not running):

```yaml
web:
  ports:
    - "3000:80"
```

After editing `docker-compose.override.yml`, start or restart Canvas from the repo root:

```bash
cd ~/canvas-lms
docker compose up -d
# or: docker compose up   (foreground, useful for first boot logs)
```

Confirm in a browser: `http://localhost:8080/` (or whichever host port you chose).

### 4.5 Access Canvas and prepare for EduAI

1. Open Canvas at `**http://localhost:<HOST_PORT>/**` (e.g. `8080`).
2. Log in with the **admin credentials** from initial setup.
3. Create a **course** and enroll your user as **Teacher**.
4. Add test students if you will test roster APIs (People → enroll users).

`**canvasUrl` in Question Maker** must match the host port exactly:

```text
http://localhost:8080
```

No trailing slash. If the browser loads Canvas, that origin is correct for API calls too.

### 4.6 Useful Canvas Docker commands (WSL)

From your `canvas-lms` clone (see [doc/docker](https://github.com/instructure/canvas-lms/tree/master/doc/docker)):

```bash
cd ~/canvas-lms

docker compose ps
docker compose logs -f web
docker compose down
docker compose up -d
```

### 4.7 Reachability from EduAI (Windows + WSL + QM Docker)

Replace `8080` with your chosen host port if different.


| EduAI runs where                           | Canvas host port | `canvasUrl` in QM connect          |
| ------------------------------------------ | ---------------- | ---------------------------------- |
| QM backend on **Windows** (npm)            | e.g. `8080`      | `http://localhost:8080`            |
| QM backend in **Docker Desktop** container | e.g. `8080`      | `http://host.docker.internal:8080` |


`localhost` inside a Linux container is the container itself — use `host.docker.internal` when QM runs in Compose.

PowerShell API check from **Windows**:

```powershell
curl.exe -s -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:8080/api/v1/courses?per_page=5"
```

---

## 5. Create a Canvas API token

1. Log in to Canvas as instructor (or admin).
2. **Account** → **Settings**.
3. **Approved Integrations** → **+ New Access Token**.
4. Purpose: e.g. `EduAI local dev`.
5. **Generate Token** → copy immediately (shown once).

Format example: `1234~AbCdEf...`

**Security:** Do not commit tokens. Revoke in Canvas if leaked. Prefer short expiry for dev.

---

## 6. Setup A — Web / host (recommended for first test)

### 6.1 Monorepo (all apps)

From `EduAICore` root:

```bash
npm install
npm run docker:dev:db    # starts Core, AI Tutor, QM databases
npm run dev              # Turborepo — includes QM on 8000 / 5173
```

Or Question Maker only (see §6.2).

### 6.2 Question Maker only (two terminals)

**Database** — either monorepo DB:

```bash
# From EduAICore root
npm run docker:dev:db:question-maker
```

Default QM DB: `postgresql://postgres:password@localhost:55432/question-maker` (port from `docker-compose.dev.yml` / `QM_DB_PORT`).

**Terminal 1 — API:**

```bash
cd apps/extensions/question-maker/app/backend
cp ../../.env.example ../../.env   # if not already at question-maker root
npm install
npm run dev
# Listens http://localhost:8000
```

**Terminal 2 — UI:**

```bash
cd apps/extensions/question-maker/app/frontend
npm install
npm run dev
# Listens http://localhost:5173
```

Ensure root `apps/extensions/question-maker/.env` has:

- `DATABASE_URL` → `localhost` and correct port (`55432` for monorepo QM DB, or `5432` if using QM’s own `docker-compose.dev.yml` postgres).
- `ENCRYPTION_KEY` — 64 hex chars.
- `JWT_SECRET` (or Core session vars if migrated per #350).
- `VITE_API_URL=http://localhost:8000` for frontend.

### 6.3 Connect Canvas in the UI

1. Open `http://localhost:5173` and log in.
2. Open an assessment → **Export to Canvas** (or flow that opens Canvas connect).
3. **Uncheck** “Use Test Mode” for real Canvas.
4. **Canvas Instance URL:** your Canvas origin, e.g. `http://localhost:8080` (or whatever host port you mapped in §4.4).
5. **API Key:** paste token from §5.
6. **Connect Canvas** → course dropdown should populate.

See [CANVAS_EXPORT.md](../../apps/extensions/question-maker/docs/features/CANVAS_EXPORT.md) for full export steps.

### 6.4 Verify with API (optional)

PowerShell — use `curl.exe` (not `curl`):

```powershell
$token = "YOUR_TOKEN"
$canvas = "http://localhost:8080"   # match your Canvas host port (§4.4)
$h = @{ Authorization = "Bearer $token" }

Invoke-RestMethod "$canvas/api/v1/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment&per_page=5" -Headers $h
```

Students + email (roster research):

```powershell
$courseId = 2
Invoke-RestMethod "$canvas/api/v1/courses/$courseId/users?enrollment_type[]=student&include[]=email&per_page=100" -Headers $h
```

Profile fallback when `email` is missing on roster row:

```powershell
Invoke-RestMethod "$canvas/api/v1/users/3/profile" -Headers $h
```

Details: [canvas-lti-vs-api-key-research.md](./canvas-lti-vs-api-key-research.md) §5.

---

## 7. Setup B — Question Maker Docker Compose

From `apps/extensions/question-maker`:

```bash
cp .env.example .env
# Edit DATABASE_URL host: postgres (service name)
# ENCRYPTION_KEY, JWT_SECRET, etc.

npm run dev:up      # postgres + backend + frontend
npm run dev:logs    # troubleshoot
npm run dev:down    # stop
```


| Service  | Port |
| -------- | ---- |
| Frontend | 5173 |
| Backend  | 8000 |
| Postgres | 5432 |


`**.env` for Compose backend:**

```env
DATABASE_URL=postgresql://postgres:password@postgres:5432/eduquery
```

(Compose file uses DB name `eduquery` — match `docker-compose.dev.yml`.)

**Canvas URL from backend container:** use `http://host.docker.internal:PORT` if Canvas is on the host (§4.2).

**Connect:** same UI steps as §6.3 at `http://localhost:5173`.

### 7.1 Monorepo Docker databases + QM on host

Common hybrid: databases from root `npm run docker:dev:db`, QM API/UI on host (§6.2). Canvas on host or Docker; use browser Canvas URL for `canvasUrl`.

### 7.2 Monorepo test Docker

CI/local full test stack uses `docker-compose.test.yml` and `scripts/test-in-docker.sh` — does **not** include Canvas. Canvas integration tests in QM use **test mode** mocks unless you add live Canvas E2E separately.

---

## 8. Production / UBC Canvas (web deployment)


| Item       | Value                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| Canvas URL | `https://canvas.ubc.ca` (confirm with LT if subdomain differs)           |
| Token      | Instructor personal token or institutional developer key (LT policy)     |
| EduAI / QM | Deployed per [DEPLOYMENT.md](../DEPLOYMENT.md) — public HTTPS URL for UI |
| Network    | EduAI server must reach Canvas over HTTPS (outbound)                     |


**Differences from local:**

- No `host.docker.internal` — use real Canvas hostname.
- Student `email` / `sis_user_id` shapes may differ from hand-made local users — run pilot API checks before relying on email-only enrollment match.
- **PIA** required for roster storage — see [strategy report](./lti-canvas-integration-report.md) §11.

---

## 9. Test mode (no Canvas)

For UI/dev without Canvas:

1. In connect dialog, enable **Use Test Mode**.
2. No `canvasUrl` / token required (placeholder stored).
3. Mock courses and export responses — see `canvasService.js` `isTestMode` branch.

---

## 10. Troubleshooting


| Symptom                                   | Likely cause                        | Fix                                                                                      |
| ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `Connection refused` to Canvas            | Wrong host/port; Canvas not running | Use browser URL; check Docker port mapping                                               |
| Empty course list                         | User not teacher in any course      | Enroll as Teacher in Canvas                                                              |
| `401 Unauthorized`                        | Bad or expired token                | Regenerate token in Canvas                                                               |
| `Canvas API error: 403`                   | Token lacks permission              | Use teacher account; check course permissions                                            |
| QM connect works from host but not Docker | `localhost` inside container        | Use `host.docker.internal`                                                               |
| PowerShell `curl -s` fails                | `curl` is `Invoke-WebRequest` alias | Use `curl.exe` or `Invoke-RestMethod`                                                    |
| Roster has no `email`                     | Canvas omits field on course users  | `GET /users/:id/profile` → `primary_email`                                               |
| Core + Canvas both on 3000                | Port conflict                       | Map Canvas to another host port in `docker-compose.override.yml` (e.g. `8080:80`) — §4.4 |


---

## 11. Checklist — first successful integration

- WSL Ubuntu installed; Docker Desktop WSL integration enabled for Ubuntu
- `git clone https://github.com/instructure/canvas-lms.git` and `./script/docker_dev_setup.sh` completed in WSL
- `docker-compose.override.yml` sets host port (e.g. `8080:80` if Core uses 3000)
- Canvas loads at `http://localhost:<port>/`; admin login works
- Teacher enrolled on at least one course
- API token created and copied
- `curl.exe` / `Invoke-RestMethod` returns courses with token
- QM `.env` has `ENCRYPTION_KEY` and working `DATABASE_URL`
- QM backend (8000) and frontend (5173) running
- Connect in UI without test mode; courses appear
- Export small assessment to Canvas quiz (optional)
- (Future) Core roster sync documented in strategy report

---

## 12. Next steps (engineering)

1. **Core:** Move or mirror Canvas connect + roster sync from QM pattern (`canvas_integrations` → Core).
2. **UBC pilot:** Run §6.4 against one real course on `canvas.ubc.ca`; record fields (redacted).
3. **LT Hub:** Personal tokens vs developer key for production.
4. **LTI:** Only if in-Canvas launch becomes a requirement — not blocking API key MVP.

---

