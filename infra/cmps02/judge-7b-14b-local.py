#!/usr/bin/env python3
"""LLM-judge 7B vs 14B on cmps02 localhost:8001 (14B as judge)."""
from __future__ import annotations

import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = os.environ.get("VLLM_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
API_KEY = os.environ.get("VLLM_API_KEY", "vllm-local")
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "qwen2.5-14b-instruct")
DIR = Path(os.environ.get("CMPS02_DIR", Path(__file__).resolve().parent))
PATH_14B = Path(os.environ.get("PATH_14B", DIR / "adequacy-14b-easy-v1.jsonl"))
PATH_7B = Path(os.environ.get("PATH_7B", DIR / "adequacy-7b-easy-v1.jsonl"))
OUT = Path(os.environ.get("OUT", DIR / "labels-7b-14b.v1.jsonl"))
SLEEP_S = float(os.environ.get("SLEEP_S", "0.5"))

SYSTEM = """You are a strict expert evaluator for educational AI tutoring.
Compare 7B and 14B answers on easy course questions. Return ONLY valid JSON:
{
  "tier7_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "tier14_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "7b_better" | "14b_better" | "incomparable",
  "medium_necessary": true | false,
  "rationale": "2-4 sentences"
}
Set medium_necessary=true only when 14B is adequate and 7B is not."""


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def index_7b(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        if row.get("response"):
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
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode())
    content = data["choices"][0]["message"]["content"]
    start = content.find("{")
    end = content.rfind("}")
    return json.loads(content[start : end + 1])


def truncate(text: str, max_len: int = 5000) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"\n\n[truncated {len(text) - max_len} chars]"


def main() -> int:
    rows14 = [r for r in load_jsonl(PATH_14B) if not r.get("error") and r.get("response")]
    map7 = index_7b(load_jsonl(PATH_7B))
    existing = {r["prompt_id"] for r in load_jsonl(OUT) if r.get("prompt_id")}

    pairs = [(r14, map7[r14["prompt_id"]]) for r14 in rows14 if r14["prompt_id"] in map7]
    pairs = [(a, b) for a, b in pairs if a["prompt_id"] not in existing]

    print(f"=== judge 7B vs 14B ({JUDGE_MODEL}) ===", flush=True)
    print(f"pairs: {len(pairs)} (skip {len(existing)} done)", flush=True)

    errors = 0
    with OUT.open("a", encoding="utf-8") as out:
        for i, (r14, r7) in enumerate(pairs, 1):
            pid = r14["prompt_id"]
            print(f"[{i}/{len(pairs)}] {pid}", flush=True)
            user = "\n".join(
                [
                    f"prompt_id: {pid}",
                    f"stratum: {r14.get('stratum')}",
                    "",
                    "## Student prompt",
                    r14["prompt"],
                    "",
                    "## 7B response",
                    truncate(r7["response"]),
                    "",
                    "## 14B response",
                    truncate(r14["response"]),
                ]
            )
            try:
                t0 = time.perf_counter()
                judge = post_judge(user)
                record = {
                    "label_version": "7b-14b-v1-py",
                    "labeled_at": datetime.now(timezone.utc).isoformat(),
                    "prompt_id": pid,
                    "stratum": r14.get("stratum"),
                    "split": r14.get("split"),
                    "tier7_adequacy": judge.get("tier7_adequacy"),
                    "tier14_adequacy": judge.get("tier14_adequacy"),
                    "quality_delta": judge.get("quality_delta"),
                    "medium_necessary": judge.get("medium_necessary") is True,
                    "judge_rationale": str(judge.get("rationale", "")).strip(),
                    "judge_model": JUDGE_MODEL,
                    "judge_duration_ms": int((time.perf_counter() - t0) * 1000),
                    "duration_7b_ms": r7.get("duration_ms"),
                    "duration_14b_ms": r14.get("duration_ms"),
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                print(f"  {judge.get('quality_delta')} medium={judge.get('medium_necessary')}", flush=True)
            except Exception as e:  # noqa: BLE001
                errors += 1
                print(f"  ERROR: {str(e)[:120]}", flush=True)
            if i < len(pairs) and SLEEP_S > 0:
                time.sleep(SLEEP_S)

    print(f"done errors={errors} out={OUT}", flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
