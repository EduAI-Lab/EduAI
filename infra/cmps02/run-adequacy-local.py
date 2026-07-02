#!/usr/bin/env python3
"""Run adequacy prompts against local LiteLLM on cmps02 (127.0.0.1:8001)."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = os.environ.get("VLLM_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
API_KEY = os.environ.get("VLLM_API_KEY", "vllm-local")
MODEL = os.environ.get("ADEQUACY_MODEL", "qwen2.5-72b-instruct")
TIER_LABEL = os.environ.get("ADEQUACY_TIER_LABEL", "XL")
PROMPTS_FILE = Path(
    os.environ.get("PROMPTS_FILE", str(Path(__file__).with_name("adequacy-prompts-hard.jsonl")))
)
OUT_FILE = Path(
    os.environ.get(
        "OUT_FILE",
        str(Path(__file__).with_name("adequacy-72b-hard-v1.jsonl")),
    )
)
RUN_LABEL = os.environ.get("RUN_LABEL", "adequacy-72b-hard-v1")
SLEEP_S = float(os.environ.get("SLEEP_S", "0.8"))
TIMEOUT_S = int(os.environ.get("TIMEOUT_S", "300"))


def post_chat(prompt: str) -> dict:
    body = json.dumps(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 2048,
        }
    ).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read().decode()
            duration_ms = int((time.perf_counter() - t0) * 1000)
            data = json.loads(raw)
            text = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            return {
                "http_status": resp.status,
                "duration_ms": duration_ms,
                "response": text,
                "finish_reason": data.get("choices", [{}])[0].get("finish_reason"),
                "error": None,
                "usage": data.get("usage"),
            }
    except urllib.error.HTTPError as e:
        duration_ms = int((time.perf_counter() - t0) * 1000)
        err_body = e.read().decode()[:500]
        return {
            "http_status": e.code,
            "duration_ms": duration_ms,
            "response": "",
            "finish_reason": None,
            "error": err_body,
            "usage": None,
        }
    except Exception as e:  # noqa: BLE001
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "http_status": 0,
            "duration_ms": duration_ms,
            "response": "",
            "finish_reason": None,
            "error": str(e),
            "usage": None,
        }


def main() -> int:
    if not PROMPTS_FILE.exists():
        print(f"Missing prompts file: {PROMPTS_FILE}", file=sys.stderr)
        return 1

    prompts = []
    for line in PROMPTS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            prompts.append(json.loads(line))

    run_started = datetime.now(timezone.utc).isoformat()
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    errors = 0

    print(f"=== adequacy local run ({MODEL}) ===", flush=True)
    print(f"prompts: {len(prompts)}", flush=True)
    print(f"output: {OUT_FILE}", flush=True)
    print(flush=True)

    with OUT_FILE.open("a", encoding="utf-8") as out:
        for i, row in enumerate(prompts, 1):
            preview = row["prompt"][:52] + ("…" if len(row["prompt"]) > 52 else "")
            print(f"[{i}/{len(prompts)}] {row['id']} — {preview}")
            result = post_chat(row["prompt"])
            if result["error"] or not result["response"]:
                errors += 1
                print(f"  ERROR: {str(result['error'])[:120]}")
            else:
                print(f"  OK {result['duration_ms']} ms, {len(result['response'])} chars")

            record = {
                "run_label": RUN_LABEL,
                "run_started": run_started,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
                "prompt_id": row["id"],
                "stratum": row.get("stratum"),
                "category": row.get("category"),
                "split": row.get("split"),
                "rag_context": row.get("rag_context"),
                "tools_expected": row.get("tools_expected"),
                "course_code": row.get("course_code"),
                "prompt": row["prompt"],
                "tier_label": TIER_LABEL,
                "model": f"vllm:{MODEL}",
                "lite_name": MODEL,
                "backend": "direct-vllm-local",
                "duration_ms": result["duration_ms"],
                "http_status": result["http_status"],
                "finish_reason": result["finish_reason"],
                "response": result["response"],
                "error": result["error"],
                "usage": result["usage"],
                "vllm_base_url": BASE_URL,
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()
            if i < len(prompts) and SLEEP_S > 0:
                time.sleep(SLEEP_S)

    print()
    print(f"done — errors={errors} output={OUT_FILE}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
