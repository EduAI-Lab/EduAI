-- #1869: disk-usage alerts are logged as host events.
ALTER TYPE "SystemLogSource" ADD VALUE IF NOT EXISTS 'HOST';
