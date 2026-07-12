/**
 * Unit tests for the Canvas URL SSRF guard (#991).
 */
import { describe, it, expect } from 'vitest';
import { validateCanvasUrl, CanvasUrlValidationError } from '../../src/utils/canvasUrlGuard.js';

describe('validateCanvasUrl', () => {
  it('accepts a well-formed https Canvas URL', () => {
    expect(() => validateCanvasUrl('https://canvas.example.edu')).not.toThrow();
  });

  it('rejects malformed URLs', () => {
    expect(() => validateCanvasUrl('not a url')).toThrow(CanvasUrlValidationError);
  });

  it('rejects http (non-HTTPS) scheme', () => {
    expect(() => validateCanvasUrl('http://canvas.example.edu')).toThrow(CanvasUrlValidationError);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => validateCanvasUrl('file:///etc/passwd')).toThrow(CanvasUrlValidationError);
  });

  it.each([
    ['cloud metadata endpoint', 'https://169.254.169.254/'],
    ['loopback', 'https://127.0.0.1/'],
    ['10.0.0.0/8', 'https://10.1.2.3/'],
    ['172.16.0.0/12', 'https://172.16.0.1/'],
    ['192.168.0.0/16', 'https://192.168.1.1/'],
    ['0.0.0.0/8', 'https://0.0.0.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv6 link-local', 'https://[fe80::1]/'],
    ['IPv6 unique local', 'https://[fd00::1]/'],
    ['IPv4-mapped IPv6 private', 'https://[::ffff:127.0.0.1]/'],
  ])('rejects %s (%s)', (_label, url) => {
    expect(() => validateCanvasUrl(url)).toThrow(CanvasUrlValidationError);
  });

  it('does not reject a public IPv4 literal', () => {
    expect(() => validateCanvasUrl('https://8.8.8.8/')).not.toThrow();
  });

  it('does not treat a private-looking hostname (not an IP literal) as private', () => {
    // Only IP literals are checked — hostnames that merely start with digits
    // (e.g. a subdomain) must not be misclassified.
    expect(() => validateCanvasUrl('https://10.example.edu/')).not.toThrow();
  });
});
