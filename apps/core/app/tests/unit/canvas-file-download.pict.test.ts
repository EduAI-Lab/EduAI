// @vitest-environment node
//
// PICT adapter (#1184, census docs/PICT_CENSUS.md § S5): one committed row table
// (tests/models/canvas-file-download.cases.json) and one spec-derived oracle assert
// downloadCanvasFile transport, auth-header, redirect credential survival, redirect
// limit, and SSRF redirect blocking via mocked fetch (no live DB). Reuses canvas-pict
// upstream file fixture defaults for file metadata.

import { afterEach, describe, expect, it, vi } from "vitest";

const { assertPublicHostnameMock } = vi.hoisted(() => ({
  assertPublicHostnameMock: vi.fn(async (_hostname: string) => {}),
}));

vi.mock("~/lib/net/ssrf-guard.server", () => ({
  assertPublicHostname: (hostname: string) => assertPublicHostnameMock(hostname),
  assertPublicIpLiteral: (_hostname: string) => {},
  UnsafeHostError: class UnsafeHostError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UnsafeHostError";
    }
  },
}));

import { CanvasApiError, downloadCanvasFile } from "~/lib/canvas/client.server";
import { buildUpstreamCanvasFile } from "../helpers/canvas-pict";
import canvasFileDownloadCases from "../../../../../tests/models/canvas-file-download.cases.json";
import {
  CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS,
  canvasFileDownloadOracle,
  canvasUrlForRow,
  expectedRewrittenRedirectUrl,
  shouldAttachBearer,
  type CanvasFileDownloadRow,
} from "../../../../../tests/models/canvas-file-download.oracle";

const rows = canvasFileDownloadCases as CanvasFileDownloadRow[];

const API_KEY = "1234~token";
const FILE_ID = "9001";
const INITIAL_PATH = `/files/${FILE_ID}/download?download_frd=1`;
const LOCAL_ORIGIN = "http://localhost:8080";
const PUBLIC_CDN_REDIRECT = "https://files.example.com/bucket/object";

function sfVerifierQuery(): string {
  return "sf_verifier=signed-token";
}

function buildInitialUrl(row: CanvasFileDownloadRow): string {
  const origin = canvasUrlForRow(row);
  if (row.AuthHeader === "absent") {
    return `${origin}${INITIAL_PATH}&${sfVerifierQuery()}`;
  }
  return `${origin}${INITIAL_PATH}`;
}

function buildRedirectLocation(row: CanvasFileDownloadRow): string {
  if (row.Redirect === "cross-host") {
    if (row.RedirectAuth === "drop") {
      return `https://cdn.example.com${INITIAL_PATH}&${sfVerifierQuery()}`;
    }
    return `https://cdn.example.com${INITIAL_PATH}&follow=1`;
  }

  const origin = LOCAL_ORIGIN;
  if (row.RedirectAuth === "drop") {
    return `${origin}${INITIAL_PATH}&${sfVerifierQuery()}`;
  }
  return `${origin}${INITIAL_PATH}&follow=1`;
}

function buildOverLimitRedirectChain(row: CanvasFileDownloadRow): string[] {
  const origin = canvasUrlForRow(row);
  const locations: string[] = [];
  for (let i = 0; i <= CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS; i++) {
    locations.push(`${origin}/redirect/${i}`);
  }
  return locations;
}

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function installFetchMock(row: CanvasFileDownloadRow): FetchCall[] {
  const calls: FetchCall[] = [];
  const redirectLocations =
    row.ByteLimit === "over" ? buildOverLimitRedirectChain(row) : [buildRedirectLocation(row)];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    if (row.Transport === "network-error") {
      throw new Error("network down");
    }

    const hopIndex = calls.length - 1;

    if (row.Redirect !== "none" && row.ByteLimit === "under" && hopIndex === 0) {
      return new Response(null, {
        status: 302,
        headers: { Location: redirectLocations[0]! },
      });
    }

    if (row.ByteLimit === "over" && hopIndex < redirectLocations.length) {
      return new Response(null, {
        status: 302,
        headers: { Location: redirectLocations[hopIndex]! },
      });
    }

    if (row.Transport === "http-4xx") {
      return new Response(null, { status: 401 });
    }

    if (row.Transport === "http-5xx") {
      return new Response(null, { status: 500 });
    }

    return new Response("file-bytes", { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function expectedBearerOnCall(row: CanvasFileDownloadRow, url: string): boolean {
  return row.AuthHeader === "present" && shouldAttachBearer(API_KEY, url);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "canvas-file-download PICT row #$index $row.Transport/$row.AuthHeader/$row.Redirect/$row.RedirectAuth/$row.ByteLimit",
  ({ row }) => {
    it("matches the oracle download verdict", async () => {
      const verdict = canvasFileDownloadOracle(row);
      assertPublicHostnameMock.mockImplementation(async () => {});
      const calls = installFetchMock(row);

      const upstream = buildUpstreamCanvasFile({
        canvasFileId: FILE_ID,
        url: buildInitialUrl(row),
      });

      const credentials = {
        canvasUrl: canvasUrlForRow(row),
        apiKey: API_KEY,
        isTestMode: false,
      };

      const file = {
        id: Number(FILE_ID),
        url: upstream.url,
        filename: "lecture.pdf",
        "content-type": "application/pdf",
      };

      if (verdict.outcome === "error") {
        await expect(downloadCanvasFile(credentials, file)).rejects.toMatchObject({
          statusCode: verdict.statusCode,
        });
        return;
      }

      const bytes = await downloadCanvasFile(credentials, file);
      expect(Buffer.from(bytes).toString()).toBe("file-bytes");

      if (row.Redirect === "none") {
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const first = calls[0]!;
        if (expectedBearerOnCall(row, first.url)) {
          expect(first.init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
        } else {
          expect(first.init?.headers ?? {}).not.toHaveProperty("Authorization");
        }
        return;
      }

      expect(calls.length).toBeGreaterThanOrEqual(2);
      const redirectHop = calls[1]!;
      const redirectLocation = buildRedirectLocation(row);
      expect(redirectHop.url).toBe(expectedRewrittenRedirectUrl(row, redirectLocation));
      if (verdict.credentialsOnRedirect === "kept") {
        expect(redirectHop.init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
      } else {
        expect(redirectHop.init?.headers ?? {}).not.toHaveProperty("Authorization");
      }
    });
  },
);

describe("canvas-file-download PICT adapter — public cross-host CDN (hand-written complement)", () => {
  it("rejects an unapproved public CDN redirect without forwarding Bearer", async () => {
    assertPublicHostnameMock.mockImplementation(async () => {});

    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: PUBLIC_CDN_REDIRECT },
          });
        }
        return new Response("cdn-bytes", { status: 200 });
      }),
    );

    await expect(
      downloadCanvasFile(
        { canvasUrl: LOCAL_ORIGIN, apiKey: API_KEY, isTestMode: false },
        {
          id: 1,
          url: `${LOCAL_ORIGIN}${INITIAL_PATH}`,
          filename: "lecture.pdf",
          "content-type": "application/pdf",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });
});

describe("CanvasApiError surface", () => {
  it("carries statusCode for PICT error rows", () => {
    const error = new CanvasApiError("Canvas file download failed: 401", 401);
    expect(error.statusCode).toBe(401);
  });
});
