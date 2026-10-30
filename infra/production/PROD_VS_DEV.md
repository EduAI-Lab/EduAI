# Prod (s348) vs dev (s378)

Last compared: 2026-10-30, with `infra/scripts/host-config-summary.sh` (#1877).

Several Week 3 outages came from undocumented drift between the hosts. This page
lists what is meant to differ, so anything else stands out as drift. Re-run the
summary on both hosts after a deploy or a manual change and compare:

```bash
sudo -v
bash infra/scripts/host-config-summary.sh > ~/host-summary-$(hostname -s).txt
```

It prints setting names, never values, so the output is safe to share.

## Intended differences

| Area | Prod (s348) | Dev (s378) |
| --- | --- | --- |
| OS / web server | Ubuntu 22.04, `apache2` (`/etc/apache2/sites-enabled`) | RHEL 8.10, `httpd` (`/etc/httpd/conf.d`) |
| Code | Release directories; `/srv/www/eduai-production/current` → `releases/<sha>` | One checkout of `development` in `/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore` |
| Settings | One root-owned file per app in `/etc/eduai` (`eduai-core.env`, `eduai-aitutor.env`, `eduai-qm.env`), plus `cron.env` for the cron scripts | Each app's `.env` in the checkout, plus `/etc/eduai/eduai-dev.env` (SMTP, `NODE_ENV`), which the units load and which wins over `.env` |
| Settings template | `/etc/eduai/production-templates/eduai-core.env`, installed with `install-env` | none |
| Unit group | `eduai` | `eduai-dev` (members may restart units, via polkit) |
| Databases | `eduai-pgvector`, `eduai-aitutor-db`, `eduai-qm-db`; database names `ai_tutor_prod` / `qm_prod` | `eduai-db`, `eduai-ai-tutor-db`, `eduai-question-maker-db`, from the checkout's `docker-compose.dev.yml` |
| Fleet model map | `/etc/eduai/fleet/fleet.config.json` (`FLEET_CONFIG_PATH`) | none yet: every server is assumed to serve `VLLM_FLEET_DEFAULT_MODELS` (see "Known drift") |
| Cron scheduling | `CRON_WEB_SCHEDULER=false`: only `eduai-cron-worker` schedules jobs (#1873) | unset: the web server schedules too |
| Host mail | `msmtp` relays alerts through the UBC relay (#1874) | none |
| Extra dev-only settings | — | research, benchmark and demo keys (`CHAT_BENCH_*`, `RESEARCH_RUN_*`, `EDUAI_ENABLE_LOCAL_DEMO`, …) |
| Public URLs | `my.` / `aitutor.` / `questionmaker.eduai.ok.ubc.ca` | `dev.` / `dev.aitutor.` / `dev.questionmaker.eduai.ok.ubc.ca` |

## Known drift (2026-10-30)

Each item is drift to fix, not a design choice.

- **Course deletes don't reach the extensions on prod.** Prod's `eduai-core.env`
  has no `AI_TUTOR_SERVER_URL` or `QM_BACKEND_URL`. Core skips an extension whose
  URL is unset, so deleting a course leaves its AI Tutor and Question Maker data
  behind. Both are now in `core.env.example`.
- **Node version:** prod runs Node 22, dev and CI run Node 24.
- **Postgres versions:** prod Core is 15 and its Question Maker database 16; dev is
  the other way round. Dev's host `psql`/`pg_dump` are version 10, so dumps on dev
  go through `docker exec`.
- **Prod has an extra unit**, `eduai-core-worker.service` (disabled, not in the repo).
- **Prod's Core vhost** is `eduai.ok.ubc.ca.conf` with no `CustomLog`/`ErrorLog`
  (it logs to Apache's shared log). The repo's `install-apache-vhost` writes
  `my.eduai.ok.ubc.ca.conf`, which would add a second vhost for the same site.
- **Dev has no fleet model map**, so a 9B request can be routed to CMPS02, which
  doesn't serve the 9B.
- **Dev's `service_eduai` crontab** still runs four jobs for the old standalone
  Question Maker (`/srv/www/questionmaker.ok.ubc.ca/scripts/`), including a
  nightly deploy.
- **Dev settings clutter:** `VLLM_EMBED_MAX_CONCURRENCY` and `CHAT_SMALL_MODEL` are
  read by no code; SMTP is set in both `eduai-dev.env` and `apps/core/.env`.
