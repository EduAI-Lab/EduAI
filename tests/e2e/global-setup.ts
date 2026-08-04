/**
 * Playwright global setup — waits for all services to be accepting requests
 * before the workers start. Mirrors the Docker healthcheck endpoints so the
 * check is guaranteed to pass once the container is marked healthy.
 */
import { request } from '@playwright/test';
import {
  CORE_URL,
  AI_TUTOR_API_URL,
  QM_BACKEND_URL,
} from './playwright.config';

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 60_000;

async function waitForUrl(url: string): Promise<void> {
  const ctx = await request.newContext();
  const deadline = Date.now() + MAX_WAIT_MS;
  let last: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const res = await ctx.get(url, { timeout: 5000 });
      if (res.status() < 500) {
        await ctx.dispose();
        return;
      }
    } catch (e: any) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await ctx.dispose();
  throw new Error(
    `Service at ${url} not ready after ${MAX_WAIT_MS}ms: ${last?.message ?? 'unknown'}`,
  );
}

export default async function globalSetup() {
  const suites = new Set((process.env.E2E_SUITES ?? 'all').split(','));
  const all = suites.has('all') || suites.has('cross-service');
  const checks = [waitForUrl(`${CORE_URL}/api/health`)];

  if (all || suites.has('ai-tutor')) {
    checks.push(waitForUrl(`${AI_TUTOR_API_URL}/api/courses`));
  }
  if (all || suites.has('question-maker')) {
    checks.push(waitForUrl(`${QM_BACKEND_URL}/api/course`));
  }

  await Promise.all(checks);
}
