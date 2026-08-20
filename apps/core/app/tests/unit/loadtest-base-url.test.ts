import { describe, expect, it } from "vitest";
import { resolveLoadtestBaseUrl } from "../../../loadtest/k6/lib/base-url.js";

describe("resolveLoadtestBaseUrl", () => {
  it("defaults to IPv4 loopback", () => {
    expect(resolveLoadtestBaseUrl(undefined, undefined)).toBe("http://127.0.0.1:4100");
  });

  it("allows loopback hosts without an opt-in", () => {
    expect(resolveLoadtestBaseUrl("http://127.0.0.1:4100", undefined)).toBe(
      "http://127.0.0.1:4100",
    );
    expect(resolveLoadtestBaseUrl("http://localhost:4100", undefined)).toBe(
      "http://localhost:4100",
    );
  });

  it("refuses a remote host unless LOADTEST_ALLOW_REMOTE=1", () => {
    expect(() => resolveLoadtestBaseUrl("https://loadtest.example.edu", undefined)).toThrow(
      /not loopback/,
    );
    expect(resolveLoadtestBaseUrl("https://loadtest.example.edu", "1")).toBe(
      "https://loadtest.example.edu",
    );
  });

  it("never allows the live study or prod hosts, even with the opt-in", () => {
    expect(() => resolveLoadtestBaseUrl("https://dev.eduai.ok.ubc.ca", "1")).toThrow(
      /live EduAI traffic/,
    );
    expect(() => resolveLoadtestBaseUrl("https://my.eduai.ok.ubc.ca", "1")).toThrow(
      /live EduAI traffic/,
    );
  });

  it("canonicalizes trailing-dot FQDNs before the live-host block", () => {
    // `new URL("https://dev.eduai.ok.ubc.ca.").hostname` retains the final
    // dot. Without stripping it, LOADTEST_ALLOW_REMOTE=1 would accept the
    // live study host.
    expect(() => resolveLoadtestBaseUrl("https://dev.eduai.ok.ubc.ca.", "1")).toThrow(
      /live EduAI traffic/,
    );
    expect(() => resolveLoadtestBaseUrl("https://DEV.EDUAI.OK.UBC.CA.", "1")).toThrow(
      /live EduAI traffic/,
    );
    expect(() => resolveLoadtestBaseUrl("https://my.eduai.ok.ubc.ca.", "1")).toThrow(
      /live EduAI traffic/,
    );
    expect(() => resolveLoadtestBaseUrl("https://dev.eduai.ok.ubc.ca..", "1")).toThrow(
      /live EduAI traffic/,
    );
    expect(() => resolveLoadtestBaseUrl("https://dev.eduai.ok.ubc.ca.:443", "1")).toThrow(
      /live EduAI traffic/,
    );
  });

  it("treats a trailing-dot loopback alias as loopback", () => {
    expect(resolveLoadtestBaseUrl("http://localhost.:4100", undefined)).toBe(
      "http://localhost.:4100",
    );
  });
});
