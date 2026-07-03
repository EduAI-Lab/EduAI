#!/usr/bin/env python3
"""LLM-judge 32B vs 72B on cmps02 localhost:8001 (72B as judge)."""
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
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "qwen2.5-72b-instruct")
DIR = Path(os.environ.get("CMPS02_DIR", Path(__file__).resolve().parent))
PATH_72B = Path(os.environ.get("PATH_72B", DIR / "adequacy-72b-hard-v1.jsonl"))
PATH_32B = Path(os.environ.get("PATH_32B", DIR / "adequacy-32b-combined-v1.jsonl"))
OUT = Path(os.environ.get("OUT", DIR / "labels-32b-72b.v1.jsonl"))
SLEEP_S = float(os.environ.get("SLEEP_S", "1.0"))

SYSTEM = """You are a strict expert evaluator for educational AI tutoring.
Compare 32B and 72B answers. Return ONLY valid JSON:
{
  "tier32_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "tier72_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "32b_better" | "72b_better" | "incomparable",
  "xl_necessary": true | false,
  "rationale": "2-4 sentences"
}
Set xl_necessary=true only when 72B is adequate and 32B is not."""


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def index_32b(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        if row.get("response") and "32b" in str(row.get("model", "")).lower():
            out[row["prompt_id"]] = row
    return out


def post_judge(user: str) -> dict:
    body = json.dumps(
        {
            "model": JUDGE_MODEL,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user},
            ],
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
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    content = data["choices"][0]["message"]["content"]
    start = content.find("{")
    end = content.rfind("}")
    return json.loads(content[start : end + 1])


def truncate(text: str, max_len: int = 6000) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"\n\n[truncated {len(text) - max_len} chars]"


def main() -> int:
    rows72 = [r for r in load_jsonl(PATH_72B) if not r.get("error") and r.get("response")]
    map32 = index_32b(load_jsonl(PATH_32B))
    existing = set()
    if OUT.exists():
        for row in load_jsonl(OUT):
            if row.get("prompt_id"):
                existing.add(row["prompt_id"])

    pairs = [(r72, map32[r72["prompt_id"]]) for r72 in rows72 if r72["prompt_id"] in map32]
    pairs = [(a, b) for a, b in pairs if a["prompt_id"] not in existing]

    print(f"=== judge 32B vs 72B ({JUDGE_MODEL}) ===", flush=True)
    print(f"pairs: {len(pairs)} (skip {len(existing)} done)", flush=True)

    errors = 0
    with OUT.open("a", encoding="utf-8") as out:
        for i, (r72, r32) in enumerate(pairs, 1):
            pid = r72["prompt_id"]
            print(f"[{i}/{len(pairs)}] {pid}", flush=True)
            user = "\n".join(
                [
                    f"prompt_id: {pid}",
                    f"stratum: {r72.get('stratum')}",
                    "",
                    "## Student prompt",
                    r72["prompt"],
                    "",
                    "## 32B response",
                    truncate(r32["response"]),
                    "",
                    "## 72B response",
                    truncate(r72["response"]),
                ]
            )
            try:
                t0 = time.perf_counter()
                judge = post_judge(user)
                record = {
                    "label_version": "32b-72b-v1-py",
                    "labeled_at": datetime.now(timezone.utc).isoformat(),
                    "prompt_id": pid,
                    "stratum": r72.get("stratum"),
                    "split": r72.get("split"),
                    "tier32_adequacy": judge.get("tier32_adequacy"),
                    "tier72_adequacy": judge.get("tier72_adequacy"),
                    "quality_delta": judge.get("quality_delta"),
                    "xl_necessary": judge.get("xl_necessary") is True,
                    "judge_rationale": str(judge.get("rationale", "")).strip(),
                    "judge_model": JUDGE_MODEL,
                    "judge_duration_ms": int((time.perf_counter() - t0) * 1000),
                    "duration_32b_ms": r32.get("duration_ms"),
                    "duration_72b_ms": r72.get("duration_ms"),
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                print(f"  {judge.get('quality_delta')} xl={judge.get('xl_necessary')}", flush=True)
            except Exception as e:  # noqa: BLE001
                errors += 1
                print(f"  ERROR: {str(e)[:120]}", flush=True)
            if i < len(pairs) and SLEEP_S > 0:
                time.sleep(SLEEP_S)

    print(f"done errors={errors} out={OUT}", flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
