-- Preserve CPU attribution when a sidecar combines RAPL and NVML energy.
-- Safe inside a Prisma transaction on PostgreSQL 12+ (EduAI uses PG15/16).
ALTER TYPE "EnergyMeasurementSource" ADD VALUE 'RAPL_PLUS_NVML';
