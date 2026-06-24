"""RAPL (CPU/DRAM) and NVML (GPU) energy sampling for EduAI research runs."""

from __future__ import annotations

import glob
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

NVML_SAMPLE_INTERVAL_S = 0.1


def _read_rapl_microjoules() -> Optional[float]:
    """Sum Intel RAPL energy_uj counters (Linux). Returns None if unavailable."""
    total = 0.0
    found = False
    for path in glob.glob("/sys/class/powercap/intel-rapl*/energy_uj"):
        try:
            with open(path, encoding="utf-8") as f:
                total += float(f.read().strip())
                found = True
        except OSError:
            continue
    return total if found else None


@dataclass
class NvmlSampler:
    gpu_index: int = 0
    _handle: object = field(default=None, repr=False)
    _available: bool = field(default=False, repr=False)
    _thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stop: threading.Event = field(default_factory=threading.Event, repr=False)
    _samples_mw: list[float] = field(default_factory=list, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def init(self) -> bool:
        try:
            import pynvml  # noqa: PLC0415

            pynvml.nvmlInit()
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(self.gpu_index)
            self._available = True
            return True
        except Exception:
            self._available = False
            return False

    def _poll_loop(self) -> None:
        import pynvml  # noqa: PLC0415

        while not self._stop.is_set():
            try:
                mw = float(pynvml.nvmlDeviceGetPowerUsage(self._handle))
                with self._lock:
                    self._samples_mw.append(mw)
            except Exception:
                pass
            time.sleep(NVML_SAMPLE_INTERVAL_S)

    def start(self) -> None:
        if not self._available:
            return
        self._stop.clear()
        with self._lock:
            self._samples_mw.clear()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self) -> Optional[float]:
        """Integrated GPU energy in Joules (trapezoidal on power samples)."""
        if not self._available:
            return None
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        with self._lock:
            samples = list(self._samples_mw)
        if len(samples) < 2:
            if len(samples) == 1:
                return samples[0] / 1000.0 * NVML_SAMPLE_INTERVAL_S
            return None
        joules = 0.0
        for i in range(1, len(samples)):
            avg_w = (samples[i - 1] + samples[i]) / 2.0 / 1000.0
            joules += avg_w * NVML_SAMPLE_INTERVAL_S
        return joules


@dataclass
class MeasurementSession:
    tag: str
    gpu_index: int
    started_at: float
    rapl_start_uj: Optional[float]
    nvml: NvmlSampler

    @classmethod
    def start(cls, tag: str, gpu_index: int = 0) -> "MeasurementSession":
        nvml = NvmlSampler(gpu_index=gpu_index)
        nvml.init()
        session = cls(
            tag=tag,
            gpu_index=gpu_index,
            started_at=time.monotonic(),
            rapl_start_uj=_read_rapl_microjoules(),
            nvml=nvml,
        )
        session.nvml.start()
        return session

    def stop(self) -> dict:
        duration_ms = int((time.monotonic() - self.started_at) * 1000)
        rapl_end_uj = _read_rapl_microjoules()
        joules_gpu = self.nvml.stop()

        joules_cpu: Optional[float] = None
        joules_dram: Optional[float] = None
        if self.rapl_start_uj is not None and rapl_end_uj is not None:
            delta_uj = max(0.0, rapl_end_uj - self.rapl_start_uj)
            joules_cpu = delta_uj / 1_000_000.0

        parts = [j for j in (joules_cpu, joules_gpu) if j is not None]
        joules_total = sum(parts) if parts else None

        sources = []
        if joules_cpu is not None:
            sources.append("RAPL_CPU")
        if joules_gpu is not None:
            sources.append("NVML_GPU")
        if len(sources) == 2:
            source = "RAPL_PLUS_NVML"
        elif len(sources) == 1:
            source = sources[0]
        else:
            source = None

        grid_gco2_per_kwh = float(os.environ.get("LOCAL_GRID_GCO2_PER_KWH", "12.0"))
        carbon_grams = (
            joules_total * grid_gco2_per_kwh / 3_600_000.0 if joules_total is not None else None
        )

        return {
            "tag": self.tag,
            "durationMs": duration_ms,
            "joulesCpu": joules_cpu,
            "joulesGpu": joules_gpu,
            "joulesDram": joules_dram,
            "joulesTotal": joules_total,
            "energyJoules": joules_total,
            "carbonGramsCO2": carbon_grams,
            "source": source,
            "raplAvailable": joules_cpu is not None,
            "nvmlAvailable": joules_gpu is not None,
        }
