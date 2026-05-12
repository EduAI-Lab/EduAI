/**
 * @vitest-environment node
 */
import './api.test.setup';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from './api';

describe('api client (axios)', () => {
  let baseUrl: string;
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          if (req.url?.startsWith('/echo')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                authorization: req.headers.authorization ?? null,
              })
            );
            return;
          }
          if (req.url?.startsWith('/unauth')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
        server.on('error', reject);
      })
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  );

  beforeEach(() => {
    localStorage.clear();
    const g = globalThis as typeof globalThis & { location: { pathname: string; href: string } };
    g.location.pathname = '/dashboard';
    g.location.href = 'http://localhost/dashboard';
    api.defaults.baseURL = baseUrl;
  });

  it('adds Authorization Bearer when token is in localStorage', async () => {
    localStorage.setItem('token', 'unit-test-jwt');
    const { data } = await api.get<{ authorization: string | null }>('/echo');
    expect(data.authorization).toBe('Bearer unit-test-jwt');
  });

  it('does not set Authorization when there is no token', async () => {
    const { data } = await api.get<{ authorization: string | null }>('/echo');
    expect(data.authorization).toBeNull();
  });

  it('clears token and user and redirects to /login on 401 when not already on login', async () => {
    localStorage.setItem('token', 'expired');
    localStorage.setItem('user', '{"id":99}');

    await expect(api.get('/unauth')).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(globalThis.location.pathname).toBe('/login');
  });

  it('does not assign location when already on /login (avoids redirect loop)', async () => {
    const g = globalThis as typeof globalThis & { location: { pathname: string; href: string } };
    g.location.pathname = '/login';
    g.location.href = 'http://localhost/login';
    localStorage.setItem('token', 'x');

    await expect(api.get('/unauth')).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(globalThis.location.pathname).toBe('/login');
    expect(globalThis.location.href).toBe('http://localhost/login');
  });
});
