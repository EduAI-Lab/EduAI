/**
 * Unit tests for the Canvas URL SSRF guard (#991).
 */
import { describe, it, expect, vi } from "vitest";
import dns from "node:dns";
import {
  validateCanvasUrl,
  createPinnedLookup,
  CanvasUrlValidationError,
} from "../../src/utils/canvasUrlGuard.js";

describe("validateCanvasUrl", () => {
  it("accepts a well-formed https Canvas URL", () => {
    expect(() => validateCanvasUrl("https://canvas.example.edu")).not.toThrow();
  });

  it("rejects malformed URLs", () => {
    expect(() => validateCanvasUrl("not a url")).toThrow(CanvasUrlValidationError);
  });

  it("rejects http (non-HTTPS) scheme", () => {
    expect(() => validateCanvasUrl("http://canvas.example.edu")).toThrow(CanvasUrlValidationError);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => validateCanvasUrl("file:///etc/passwd")).toThrow(CanvasUrlValidationError);
  });

  it.each([
    ['credentials', 'https://user:password@canvas.example.edu/'],
    ['a non-root path', 'https://canvas.example.edu/canvas'],
    ['a query', 'https://canvas.example.edu/?tenant=one'],
    ['a fragment', 'https://canvas.example.edu/#settings'],
  ])('rejects a Canvas base URL containing %s', (_label, url) => {
    expect(() => validateCanvasUrl(url)).toThrow(CanvasUrlValidationError);
  });

  it.each([
    ['cloud metadata endpoint', 'https://169.254.169.254/'],
    ['loopback', 'https://127.0.0.1/'],
    ['10.0.0.0/8', 'https://10.1.2.3/'],
    ['172.16.0.0/12', 'https://172.16.0.1/'],
    ['192.168.0.0/16', 'https://192.168.1.1/'],
    ['0.0.0.0/8', 'https://0.0.0.1/'],
    ['carrier-grade NAT 100.64/10', 'https://100.64.0.1/'],
    ['benchmarking 198.18/15', 'https://198.19.255.254/'],
    ['documentation 192.0.2/24', 'https://192.0.2.1/'],
    ['multicast 224/4', 'https://224.0.0.1/'],
    ['reserved 240/4', 'https://240.0.0.1/'],
    ['limited broadcast', 'https://255.255.255.255/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv6 unspecified', 'https://[::]/'],
    ['IPv6 link-local (fe80 prefix)', 'https://[fe80::1]/'],
    ['IPv6 link-local, upper /10 boundary (fe81)', 'https://[fe81::1]/'],
    ['IPv6 link-local, upper /10 boundary (febf)', 'https://[febf::1]/'],
    ['IPv6 unique local (fc00 prefix)', 'https://[fc00::1]/'],
    ['IPv6 unique local (fd00 prefix)', 'https://[fd00::1]/'],
    ['IPv6 unique local, upper /7 boundary (fdff)', 'https://[fdff::1]/'],
    ['IPv4-mapped IPv6 private', 'https://[::ffff:127.0.0.1]/'],
    ['IPv4-compatible IPv6 loopback (deprecated form)', 'https://[::127.0.0.1]/'],
    ['IPv4-compatible IPv6 loopback, already-normalized hex form', 'https://[::7f00:1]/'],
    ['IPv4-compatible IPv6 private (10/8)', 'https://[::10.1.2.3]/'],
    ['IPv6 documentation range', 'https://[2001:db8::1]/'],
    ['IPv6 multicast', 'https://[ff02::1]/'],
  ])('rejects %s (%s)', (_label, url) => {
    expect(() => validateCanvasUrl(url)).toThrow(CanvasUrlValidationError);
  });

  it.each([
    ['just below the link-local /10 range (fe7f)', 'https://[fe7f::1]/'],
    ['deprecated site-local space (fec0)', 'https://[fec0::1]/'],
    ['outside global-unicast space (fbff)', 'https://[fbff::1]/'],
    ['outside global-unicast space (fe00)', 'https://[fe00::1]/'],
  ])('rejects a non-globally-routable IPv6 boundary address (%s)', (_label, url) => {
    expect(() => validateCanvasUrl(url)).toThrow(CanvasUrlValidationError);
  });

  it('accepts a legitimate explicit HTTPS port and exposes its canonical origin', () => {
    expect(validateCanvasUrl('https://CANVAS.example.edu:8443/').origin).toBe(
      'https://canvas.example.edu:8443',
    );
  });

  it("does not reject a public IPv4 literal", () => {
    expect(() => validateCanvasUrl("https://8.8.8.8/")).not.toThrow();
  });

  it("does not reject a public IPv4-compatible IPv6 literal", () => {
    expect(() => validateCanvasUrl("https://[::8.8.8.8]/")).not.toThrow();
  });

  it("does not treat a private-looking hostname (not an IP literal) as private", () => {
    // Only IP literals are checked — hostnames that merely start with digits
    // (e.g. a subdomain) must not be misclassified.
    expect(() => validateCanvasUrl("https://10.example.edu/")).not.toThrow();
  });

  it.each([
    ["decimal (2130706433 = 127.0.0.1)", "https://2130706433/"],
    ["hex (0x7f000001 = 127.0.0.1)", "https://0x7f000001/"],
    ["octal (0177.0.0.1 = 127.0.0.1)", "https://0177.0.0.1/"],
    ["decimal (167838211 = 10.1.2.3)", "https://167838211/"],
  ])("rejects an IPv4 loopback/private address obfuscated as %s", (_label, url) => {
    // The WHATWG URL parser canonicalizes these to dotted-decimal before
    // validateCanvasUrl ever sees `hostname`, so the classic SSRF-filter
    // bypass via alternate IP encodings is closed — lock that in here.
    expect(() => validateCanvasUrl(url)).toThrow(CanvasUrlValidationError);
  });

  it("does not reject a public IPv4 literal obfuscated as decimal (134744072 = 8.8.8.8)", () => {
    expect(() => validateCanvasUrl("https://134744072/")).not.toThrow();
  });
});

describe("createPinnedLookup", () => {
  it("rejects a hostname that resolves to a private address (DNS rebinding)", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_hostname, _options, cb) => {
      cb(null, [{ address: "169.254.169.254", family: 4 }]);
    });

    const lookup = createPinnedLookup();
    await new Promise((resolve) => {
      lookup("canvas.example.edu", {}, (err) => {
        expect(err).toBeInstanceOf(CanvasUrlValidationError);
        resolve();
      });
    });

    vi.restoreAllMocks();
  });

  it("pins to the first validated address when resolution is public", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_hostname, _options, cb) => {
      cb(null, [{ address: "8.8.8.8", family: 4 }]);
    });

    const lookup = createPinnedLookup();
    await new Promise((resolve) => {
      lookup("canvas.example.edu", {}, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe("8.8.8.8");
        expect(family).toBe(4);
        resolve();
      });
    });

    vi.restoreAllMocks();
  });

  it("rejects when any resolved address (not just the first) is private", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_hostname, _options, cb) => {
      cb(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    });

    const lookup = createPinnedLookup();
    await new Promise((resolve) => {
      lookup("canvas.example.edu", {}, (err) => {
        expect(err).toBeInstanceOf(CanvasUrlValidationError);
        resolve();
      });
    });

    vi.restoreAllMocks();
  });

  it.each(['100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '2001:db8::1', 'ff02::1'])(
    'rejects a DNS result in a non-globally-routable range (%s)',
    async (address) => {
      vi.spyOn(dns, 'lookup').mockImplementation((_hostname, _options, cb) => {
        cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
      });
      const lookup = createPinnedLookup();
      await new Promise((resolve) => {
        lookup('canvas.example.edu', {}, (err) => {
          expect(err).toBeInstanceOf(CanvasUrlValidationError);
          resolve();
        });
      });
      vi.restoreAllMocks();
    },
  );

  it('fails closed with a clean error when resolution returns no addresses', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation((_hostname, _options, cb) => {
      cb(null, []);
    });

    const lookup = createPinnedLookup();
    await new Promise((resolve) => {
      lookup("canvas.example.edu", {}, (err, address) => {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TypeError);
        expect(address).toBeUndefined();
        resolve();
      });
    });

    vi.restoreAllMocks();
  });
});
