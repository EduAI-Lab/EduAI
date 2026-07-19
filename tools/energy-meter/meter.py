"""RAPL (CPU/DRAM) and NVML (GPU) energy sampling for EduAI research runs."""

from __future__ import annotations

import glob
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

NVML_SAMPLE_INTERVAL_S = 0.1
MAX_GPU_INDEX = 7


@dataclass(frozen=True)
class RaplZoneReading:
    zone: str
    uj: float
    max_uj: Optional[float]


def _read_rapl_zones() -> Optional[list[RaplZoneReading]]:
    """Read Intel RAPL package-* counters with wrap ranges.

    Confirmed on cmps01: package-0/package-1 are CPU packages; dram and psys
    are separate domains and must not be summed. MMIO mirrors (if present)
    are skipped via the package- name check.
    """
    zones: list[RaplZoneReading] = []
    for path in glob.glob("/sys/class/powercap/intel-rapl:*/energy_uj"):
        zone_dir = os.path.dirname(path)
        zone = os.path.basename(zone_dir)
        # Skip sub-zones (intel-rapl:0:0) and mmio mirrors.
        if "-mmio" in zone or zone.count(":") != 1:
            continue
        try:
            with open(os.path.join(zone_dir, "name"), encoding="utf-8") as nf:
                domain = nf.read().strip()
            if not domain.startswith("package-"):
                continue
            with open(path, encoding="utf-8") as f:
                uj = float(f.read().strip())
            max_uj: Optional[float] = None
            max_path = os.path.join(zone_dir, "max_energy_range_uj")
            try:
                with open(max_path, encoding="utf-8") as mf:
                    raw_max = float(mf.read().strip())
                if raw_max > 0:
                    max_uj = raw_max
            except OSError:
                pass
            zones.append(RaplZoneReading(zone=zone, uj=uj, max_uj=max_uj))
        except OSError:
            continue
    return zones if zones else None


def rapl_delta_joules(
    start_zones: list[RaplZoneReading],
    end_zones: list[RaplZoneReading],
) -> Optional[float]:
    """Wrap-aware package delta in joules (mirrors Node rapl-util.mjs)."""
    if not start_zones or not end_zones:
        return None
    end_by_zone = {z.zone: z for z in end_zones}
    total_uj = 0.0
    paired = 0
    for start in start_zones:
        end = end_by_zone.get(start.zone)
        if end is None:
            continue
        delta = end.uj - start.uj
        if delta < 0:
            range_uj = start.max_uj if start.max_uj is not None else end.max_uj
            if range_uj is not None and range_uj > 0:
                delta += range_uj
            else:
                delta = 0.0
        total_uj += delta
        paired += 1
    return total_uj / 1_000_000.0 if paired else None


def _validate_gpu_indices(raw: list) -> Optional[list[int]]:
    indices: list[int] = []
    for value in raw:
        try:
            n = int(value)
        except (TypeError, ValueError):
            return None
        if n < 0 or n > MAX_GPU_INDEX:
            return None
        if n not in indices:
            indices.append(n)
    return indices if indices else None


def list_visible_gpu_indices() -> list[int]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode != 0:
            return []
        indices: list[int] = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                indices.append(int(line))
            except ValueError:
                continue
        return indices
    except (OSError, subprocess.SubprocessError):
        return []


def resolve_gpu_indices(
    body_gpu_index: object = None,
    body_gpu_indices: object = None,
) -> list[int]:
    """Match Node server.mjs: ENERGY_GPU_INDICES, request body, or all visible GPUs."""
    visible = list_visible_gpu_indices()

    if body_gpu_indices is not None:
        if not isinstance(body_gpu_indices, list):
            raise ValueError("gpuIndices must be an array")
        validated = _validate_gpu_indices(body_gpu_indices)
        if not validated:
            raise ValueError("invalid gpuIndices")
        candidates = validated
    elif body_gpu_index is not None:
        validated = _validate_gpu_indices([body_gpu_index])
        if not validated:
            raise ValueError("invalid gpuIndex")
        candidates = validated
    else:
        raw = os.environ.get("ENERGY_GPU_INDICES", "").strip()
        if raw:
            validated = _validate_gpu_indices([s.strip() for s in raw.split(",") if s.strip()])
            candidates = validated if validated else [0]
        else:
            candidates = visible if visible else [0]

    if visible:
        filtered = [i for i in candidates if i in visible]
        if not filtered:
            raise ValueError(
                f"requested GPUs {candidates} not visible (have {visible or 'none'})"
            )
        return filtered
    return candidates


@dataclass
class NvmlSampler:
    gpu_indices: list[int] = field(default_factory=lambda: [0])
    _handles: list = field(default_factory=list, repr=False)
    _available: bool = field(default=False, repr=False)
    _thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stop: threading.Event = field(default_factory=threading.Event, repr=False)
    _samples: list[tuple[float, float]] = field(default_factory=list, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def init(self) -> bool:
        try:
            import pynvml  # noqa: PLC0415

            pynvml.nvmlInit()
            handles = []
            for idx in self.gpu_indices:
                handles.append(pynvml.nvmlDeviceGetHandleByIndex(idx))
            self._handles = handles
            self._available = bool(handles)
            return self._available
        except Exception:
            self._available = False
            return False

    def _poll_loop(self) -> None:
        import pynvml  # noqa: PLC0415

        while not self._stop.is_set():
            try:
                total_mw = 0.0
                for handle in self._handles:
                    total_mw += float(pynvml.nvmlDeviceGetPowerUsage(handle))
                t = time.monotonic()
                with self._lock:
                    self._samples.append((t, total_mw))
            except Exception:
                pass
            time.sleep(NVML_SAMPLE_INTERVAL_S)

    def start(self) -> None:
        if not self._available:
            return
        self._stop.clear()
        with self._lock:
            self._samples.clear()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self) -> Optional[float]:
        """Integrated GPU energy in Joules (trapezoidal on timed power samples)."""
        if not self._available:
            return None
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        with self._lock:
            samples = list(self._samples)
        if len(samples) < 2:
            if len(samples) == 1:
                return samples[0][1] / 1000.0 * NVML_SAMPLE_INTERVAL_S
            return None
        joules = 0.0
        for i in range(1, len(samples)):
            t0, mw0 = samples[i - 1]
            t1, mw1 = samples[i]
            avg_w = (mw0 + mw1) / 2.0 / 1000.0
            dt = t1 - t0 if t1 > t0 else NVML_SAMPLE_INTERVAL_S
            joules += avg_w * dt
        return joules


@dataclass
class MeasurementSession:
    tag: str
    gpu_indices: list[int]
    started_at: float
    rapl_start: Optional[list[RaplZoneReading]]
    nvml: NvmlSampler

    @classmethod
    def start(cls, tag: str, gpu_indices: Optional[list[int]] = None) -> "MeasurementSession":
        indices = gpu_indices if gpu_indices else [0]
        nvml = NvmlSampler(gpu_indices=indices)
        nvml.init()
        session = cls(
            tag=tag,
            gpu_indices=indices,
            started_at=time.monotonic(),
            rapl_start=_read_rapl_zones(),
            nvml=nvml,
        )
        session.nvml.start()
        return session

    def stop(self) -> dict:
        duration_ms = int((time.monotonic() - self.started_at) * 1000)
        rapl_end = _read_rapl_zones()
        joules_gpu = self.nvml.stop()

        joules_cpu: Optional[float] = None
        joules_dram: Optional[float] = None
        if self.rapl_start is not None and rapl_end is not None:
            joules_cpu = rapl_delta_joules(self.rapl_start, rapl_end)

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
            "gpuIndices": self.gpu_indices,
        }
