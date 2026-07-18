# GPU energy sidecar — nvidia-smi power.draw polling (no host pip/node install).
FROM node:20-bookworm-slim
WORKDIR /app
COPY server.mjs rapl-util.mjs ./
ENV ENERGY_METER_HOST=127.0.0.1
ENV ENERGY_METER_PORT=9100
ENV ENERGY_GPU_INDICES=0,1
ENV ENERGY_SAMPLE_MS=1000
EXPOSE 9100
# Fail the build (not the first request) if server.mjs or its local imports are broken.
RUN node --check server.mjs && node -e "import('./rapl-util.mjs')"
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.ENERGY_METER_PORT||9100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
