#!/usr/bin/env python3
"""
HTTP sidecar for hardware energy measurement (RAPL + NVML).

Endpoints:
  GET  /health
  POST /measure-start  { "tag": "optional-id", "gpuIndex": 0 } or { "gpuIndices": [0,1] }
  POST /measure-stop   { "tag": "optional-id" }
  POST /measure        legacy noop summary (returns last stop or zeros)

Run on the inference host (Linux + NVIDIA):
  pip install -r requirements.txt
  ENERGY_METER_PORT=9100 python server.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from meter import MeasurementSession, resolve_gpu_indices

HOST = os.environ.get("ENERGY_METER_HOST", "127.0.0.1")
PORT = int(os.environ.get("ENERGY_METER_PORT", "9100"))

_sessions: dict[str, MeasurementSession] = {}
_lock = threading.Lock()
_last_result: dict[str, Any] | None = None


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", 0))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


def _send_json(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class EnergyMeterHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            _send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": "eduai-energy-meter",
                    "port": PORT,
                },
            )
            return
        _send_json(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        global _last_result
        path = urlparse(self.path).path
        body = _read_json(self)

        if path == "/measure-start":
            tag = str(body.get("tag") or uuid.uuid4())
            try:
                gpu_indices = resolve_gpu_indices(
                    body_gpu_index=body.get("gpuIndex"),
                    body_gpu_indices=body.get("gpuIndices"),
                )
            except ValueError as exc:
                _send_json(self, 400, {"error": str(exc)})
                return
            with _lock:
                # Host-wide RAPL/NVML counters — serialize to one active session.
                if _sessions:
                    _send_json(
                        self,
                        409,
                        {
                            "error": "another measurement session is already active; wait for measure-stop",
                        },
                    )
                    return
                if tag in _sessions:
                    _send_json(self, 409, {"error": f"session already active: {tag}"})
                    return
                _sessions[tag] = MeasurementSession.start(tag=tag, gpu_indices=gpu_indices)
            _send_json(self, 200, {"ok": True, "tag": tag, "gpuIndices": gpu_indices})
            return

        if path == "/measure-stop":
            tag = body.get("tag")
            with _lock:
                if tag:
                    session = _sessions.pop(str(tag), None)
                elif len(_sessions) == 1:
                    session = _sessions.pop(next(iter(_sessions)))
                else:
                    session = None
            if session is None:
                _send_json(self, 404, {"error": "no active measurement session"})
                return
            result = session.stop()
            _last_result = result
            _send_json(self, 200, result)
            return

        if path == "/measure":
            # Legacy manual-debugging compatibility; application telemetry uses tagged sessions.
            if _last_result:
                _send_json(
                    self,
                    200,
                    {
                        "energyJoules": _last_result.get("energyJoules"),
                        "carbonGramsCO2": _last_result.get("carbonGramsCO2"),
                        "source": _last_result.get("source"),
                    },
                )
            else:
                _send_json(
                    self,
                    200,
                    {"energyJoules": None, "carbonGramsCO2": None, "source": None},
                )
            return

        _send_json(self, 404, {"error": "not found"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), EnergyMeterHandler)
    print(f"eduai-energy-meter listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
