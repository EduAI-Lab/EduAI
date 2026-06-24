# GPU energy sidecar — nvidia-smi power.draw polling (no host pip/node install).
FROM node:20-bookworm-slim
WORKDIR /app
COPY server.mjs ./
ENV ENERGY_METER_HOST=0.0.0.0
ENV ENERGY_METER_PORT=9100
ENV ENERGY_GPU_INDICES=0,1
ENV ENERGY_SAMPLE_MS=1000
EXPOSE 9100
CMD ["node", "server.mjs"]
