/** Real socket regression for caller-disconnect cancellation propagation. */
import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canvasRequestContext,
  currentCanvasRequestSignal,
} from '../../src/middleware/canvasRequestContext.js';

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe('canvasRequestContext', () => {
  it('aborts a pending upstream when the client closes after its request body completed', async () => {
    const app = express();
    app.use(canvasRequestContext);

    let signalReady;
    const signalPromise = new Promise((resolve) => {
      signalReady = resolve;
    });

    app.get('/pending', async (_req, res) => {
      const signal = currentCanvasRequestSignal();
      signalReady(signal);
      try {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } catch {
        if (!res.writableEnded) res.destroy();
      }
    });

    const server = http.createServer(app);
    servers.add(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const client = http.request({ port, host: '127.0.0.1', path: '/pending', method: 'GET' });
    client.on('error', () => {});
    client.end();

    const signal = await signalPromise;
    const aborted = new Promise((resolve) => {
      if (signal.aborted) resolve(signal.reason);
      else signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
    });
    // The request body has already completed; closing the socket must still
    // cancel the pending Canvas/Axios operation.
    client.destroy();

    await expect(aborted).resolves.toMatchObject({ name: 'AbortError' });
  });
});

