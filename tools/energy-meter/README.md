# EduAI energy meter sidecar

Hardware energy measurement for URA research runs (RAPL CPU + NVML GPU).

## Requirements

- **Linux** host with Intel RAPL (`/sys/class/powercap/intel-rapl*/energy_uj`)
- **NVIDIA GPU** with NVML (`pynvml`) for GPU Joules
- Run on the **same machine as vLLM** (s378 / cmps01), not on a Windows dev laptop

## Install

```bash
cd tools/energy-meter
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

**Node (s378 — Python 3.6 too old for `server.py`):**

```bash
export ENERGY_METER_PORT=9100
export LOCAL_GRID_GCO2_PER_KWH=12
node server.mjs
```

**Python (cmps01 / GPU host with Python ≥3.7):**

```bash
export ENERGY_METER_PORT=9100
export LOCAL_GRID_GCO2_PER_KWH=12   # BC hydro ~12 g/kWh (adjust per run log)
python3 server.py
```

On **cmps01** (where vLLM runs), bind locally and point research at the inference host:

```bash
cd tools/energy-meter
nohup node server.mjs >>/tmp/energy-meter.log 2>&1 &
# apps/core/.env on s378: ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:9100
```

s378 has no RAPL/NVML — the sidecar there returns `energyJoules: null`; real Joules require cmps01.

Health check: `curl http://127.0.0.1:9100/health`

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ ok: true }` |
| POST | `/measure-start` | `{ tag?, gpuIndex? }` | `{ ok, tag }` |
| POST | `/measure-stop` | `{ tag? }` | `{ joulesCpu, joulesGpu, joulesTotal, energyJoules, carbonGramsCO2, source, durationMs }` |

`source` is `RAPL_CPU`, `NVML_GPU`, or `RAPL_PLUS_NVML` when both are available.

## EduAI / research wiring

On s378, in `apps/core/.env.research`:

```bash
ENERGY_SIDECAR_URL=http://127.0.0.1:9100
RESEARCH_MEASURE_ENERGY=1
```

Then run measured policy comparison:

```bash
cd apps/core && source .env.research
npm run research:run-policy -- \
  # RESEARCH_RUN_SPLIT=test RESEARCH_POLICY=both RESEARCH_REPLICATE=3
```

Output JSONL rows include `joules_cpu`, `joules_gpu`, `energy_joules`, `energy_source`, `carbon_grams_co2`.

## Protocol note

Per `EXPERIMENT_PLAN.md` §4.2, for highest quality runs add 5s idle baseline between prompts (`RESEARCH_ENERGY_SETTLE_MS=5000`). Default is 0 for faster iteration.
