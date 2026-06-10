# Windows dev database (port 54320)

Mac/Linux teammates use `CORE_DB_PORT=54320` and `DATABASE_URL=...@localhost:54320/...` unchanged.

On some Windows machines, Hyper-V reserves TCP ports **54225–54324**, which includes **54320**. Docker may show `54320->5432` in `docker ps`, but nothing listens on the host, and Prisma reports **P1001**.

Check:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
Test-NetConnection 127.0.0.1 -Port 54320
```

---

## Option A — Fix Windows (keep default 54320 everywhere)

Run **PowerShell as Administrator**, then **reboot**:

```powershell
netsh int ipv4 set dynamicport tcp start=49152 num=16384
netsh int ipv4 set dynamicport udp start=49152 num=16384
```

After reboot, confirm 54320 is not inside an excluded range, then:

```powershell
cd EduAICore
docker compose -f docker-compose.dev.yml up -d --force-recreate eduai-db
Test-NetConnection 127.0.0.1 -Port 54320
```

No `.env` changes needed if this works.

---

## Option B — Port proxy (no `.env` edits)

Keep `DATABASE_URL` on **54320**. Run Docker on a free host port for one terminal session, forward 54320 → that port.

**1. Start DB on a free port (session only, not a file):**

```powershell
cd EduAICore
$env:CORE_DB_PORT = "15432"
docker compose -f docker-compose.dev.yml up -d --force-recreate eduai-db
```

**2. Forward 54320 → 15432 (Administrator, once per boot or add a startup script):**

```powershell
netsh interface portproxy add v4tov4 listenport=54320 listenaddress=127.0.0.1 connectport=15432 connectaddress=127.0.0.1
```

**3. Verify:**

```powershell
Test-NetConnection 127.0.0.1 -Port 54320
cd apps\core
npx prisma migrate status
```

Remove proxy later:

```powershell
netsh interface portproxy delete v4tov4 listenport=54320 listenaddress=127.0.0.1
```

---

## Option C — Session env only (Prisma/one-off commands)

Do not edit `apps/core/.env`; override for the current shell:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:15432/eduai?schema=public"
$env:CORE_DB_PORT = "15432"
```

Use with `npx prisma migrate deploy`, etc. Your IDE/dev server still reads `.env` unless it inherits the shell env.

---

## Option D — Gitignored local override

Copy root `.env.example` → `.env` (already gitignored) and set only `CORE_DB_PORT=15432` plus matching `DATABASE_URL` in `apps/core/.env`. Teammates on Mac keep defaults; your files stay local.

---

## Integration tests (`npm test`)

Integration tests use database `eduai_test` on the **same Postgres host/port as `apps/core/.env`** when that file exists. You do not need a second server or to edit `apps/core/.env.test` port for Windows.

Ensure dev Postgres is running, then:

```powershell
cd apps\core
npm run test:integration
```

`globalSetup` creates `eduai_test` on that instance if missing.
