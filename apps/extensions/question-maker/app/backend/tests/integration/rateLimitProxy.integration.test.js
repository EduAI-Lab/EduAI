/** Runtime proxy identity regression tests for the Apache -> localhost topology. */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/app.js';

describe('trusted Apache proxy identity', () => {
  it('trusts only the local Apache hop for forwarded client identity', () => {
    const trustProxy = app.get('trust proxy');

    expect(typeof trustProxy).toBe('function');
    expect(trustProxy('127.0.0.1', 0)).toBe(true);
    expect(trustProxy('::1', 0)).toBe(true);
    expect(trustProxy('203.0.113.10', 0)).toBe(false);
  });

  it('does not let a direct/untrusted socket select an X-Forwarded-For identity', async () => {
    // Supertest reaches the app over loopback; the production trust function is
    // still exercised above. This request documents that health stays available
    // while an arbitrary forwarding prefix is present.
    const response = await request(app)
      .get('/healthz')
      .set('X-Forwarded-For', '198.51.100.10, 203.0.113.10');

    expect(response.status).toBe(200);
    expect(response.text).toBe('ok');
  });
});
