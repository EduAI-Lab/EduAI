-- Preserve CPU attribution when a sidecar combines RAPL and NVML energy.
ALTER TYPE "EnergyMeasurementSource" ADD VALUE 'RAPL_PLUS_NVML';
