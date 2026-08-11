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
    // Give Node time to emit the ordinary completed-request `close` event;
    // that event must not disarm the later response-close cancellation hook.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal.aborted).toBe(false);
    const aborted = new Promise((resolve) => {
      if (signal.aborted) resolve(signal.reason);
      else signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
    });
    // The request body has already completed; closing the socket must still
    // cancel the pending Canvas/Axios operation.
    client.destroy();

    await expect(aborted).resolves.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the signal live during a normal delayed response and finish', async () => {
    const app = express();
    app.use(canvasRequestContext);
    let handlerSignal;
    app.get('/delayed', async (_req, res) => {
      handlerSignal = currentCanvasRequestSignal();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(handlerSignal.aborted).toBe(false);
      res.end('ok');
    });

    const server = http.createServer(app);
    servers.add(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const responseBody = await new Promise((resolve, reject) => {
      const client = http.request({ port, host: '127.0.0.1', path: '/delayed' }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve(body));
      });
      client.on('error', reject);
      client.end();
    });

    expect(responseBody).toBe('ok');
    expect(handlerSignal.aborted).toBe(false);
  });
});
