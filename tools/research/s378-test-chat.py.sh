#!/usr/bin/env bash
set -uo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

python3 <<'PY'
import json, os, subprocess, urllib.request

vllm_key = os.environ["VLLM_API_KEY"]
eduai_key = os.environ["EDUAI_API_KEY"]
cookie = os.environ.get("RESEARCH_RUN_COOKIE", "")

def chat(label, headers, body):
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/chat",
        data=json.dumps(body).encode(),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()[:1500]
            tier = r.headers.get("x-routing-tier")
            model = r.headers.get("x-routed-model")
            print(f"=== {label} status={r.status} tier={tier} model={model} ===")
            print(text)
    except Exception as e:
        if hasattr(e, "read"):
            print(f"=== {label} error ===")
            print(e.read().decode()[:1500])
        else:
            print(f"=== {label} error ===", e)

api_keys = {"vllm": {"apiKey": vllm_key, "isEnabled": True}}
base = {
    "messages": [{"id": "u1", "role": "user", "content": "Say hi in one word"}],
    "model": "auto",
    "streaming": False,
    "apiKeys": api_keys,
}

chat("bearer", {"Authorization": f"Bearer {eduai_key}"}, base)

# find enrolled course via prisma
subprocess.run(
    ["npx", "tsx", "scripts/research/tmp-list-enrollments.ts"],
    cwd="/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core",
    check=False,
)
PY
