/**
 * Canvas integration service that manages token storage, course mappings, exports, and imports.
 * Supports both real Canvas API calls and a mock test mode for development/demo flows.
 */
import axios from 'axios';
import { prisma } from '../config/database.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { getAssessmentById, createAssessment } from './assessmentService.js';
import { createAssessmentSection } from './assessmentSectionService.js';
import { validateCanvasUrl, createPinnedLookup } from '../utils/canvasUrlGuard.js';
import { logger } from '../utils/logger.js';
import { toStableUpstreamError } from '../utils/safeLogging.js';
import { config } from '../config/settings.js';
import { currentCanvasRequestSignal } from '../middleware/canvasRequestContext.js';
import net from 'node:net';
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
} from 'node:zlib';

/**
 * Canvas LMS API Service
 * Supports both real Canvas API integration and test mode for development
 */

/** Positive integer Canvas / route ids — rejects query-injection / path-traversal payloads. */
export function parseCanvasNumericId(value, label = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return n;
}

// Mock data for test mode
const MOCK_CANVAS_COURSES = [
  { id: 1, name: "Introduction to Computer Science", course_code: "COSC 101" },
  { id: 2, name: "Data Structures and Algorithms", course_code: "COSC 201" },
  { id: 3, name: "Machine Architecture", course_code: "COSC 211" },
  { id: 4, name: "Computer Programming II", course_code: "COSC 121" },
];

/** Retrieves the Canvas integration settings (if any) for the specified user. */
export const getCanvasIntegration = async (userId) => {
  try {
    const integration = await prisma.canvasIntegration.findUnique({
      where: { userId },
    });
    if (!integration) return null;

    // apiKey is stored encrypted (Sequelize used to decrypt this via a model
    // getter; Prisma has no field-level accessors, so decrypt explicitly here).
    return { ...integration, apiKey: decrypt(integration.apiKey) };
  } catch (error) {
    throw new Error(`Failed to get Canvas integration: ${error.message}`);
  }
};

/** Creates or updates the Canvas integration credentials/test-mode flag for a user. */
export const saveCanvasIntegration = async (userId, { canvasUrl, apiKey, isTestMode = false }) => {
  try {
    // Encrypt on write (Sequelize used to do this via a model setter + hooks).
    // Idempotent: leaves an already-encrypted value (e.g. re-saved from a prior
    // read) as-is instead of double-encrypting.
    const storedApiKey = isEncrypted(apiKey) ? apiKey : encrypt(apiKey);

    const integration = await prisma.canvasIntegration.upsert({
      where: { userId },
      create: { userId, canvasUrl, apiKey: storedApiKey, isTestMode },
      update: { canvasUrl, apiKey: storedApiKey, isTestMode },
    });

    return { ...integration, apiKey: decrypt(integration.apiKey) };
  } catch (error) {
    throw new Error(`Failed to save Canvas integration: ${error.message}`);
  }
};

/** Encodes one opaque Canvas identifier without allowing it to change URL structure. */
const canvasPathSegment = (value, label) => {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    String(value).length === 0
  ) {
    throw new Error(`${label} must be a non-empty string or finite number`);
  }
  return encodeURIComponent(String(value));
};

const CANVAS_DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const CANVAS_DEFAULT_OPERATION_TIMEOUT_MS = 60_000;
const CANVAS_DEFAULT_COMPRESSED_RESPONSE_BYTES = 10 * 1024 * 1024;
const CANVAS_DEFAULT_RESPONSE_BYTES = 10 * 1024 * 1024;
const CANVAS_DEFAULT_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const CANVAS_DEFAULT_MAX_PAGES = 100;
const CANVAS_DEFAULT_MAX_ITEMS = 10_000;

const configuredPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const CANVAS_SETTING_ALIASES = {
  canvasRequestTimeoutMs: ['canvasPerRequestTimeoutMs'],
  canvasOperationTimeoutMs: ['canvasPaginationDeadlineMs'],
  canvasMaxCompressedResponseBytes: ['canvasMaxWireBytes'],
  canvasMaxResponseBytes: ['canvasMaxDecompressedResponseBytes'],
  canvasMaxRequestBodyBytes: ['canvasMaxBodyBytes'],
  canvasMaxPages: ['canvasPaginationMaxPages'],
  canvasMaxItems: ['canvasPaginationMaxItems'],
};

const canvasLimit = (name, fallback) => {
  const value = config?.[name] ?? CANVAS_SETTING_ALIASES[name]?.map((alias) => config?.[alias]).find((candidate) => candidate != null);
  return configuredPositiveInt(value, fallback);
};

export class CanvasResponseLimitError extends Error {
  constructor(message = 'Canvas response exceeded the configured size limit') {
    super(message);
    this.name = 'CanvasResponseLimitError';
    this.code = 'CANVAS_RESPONSE_TOO_LARGE';
    this.status = 502;
    this.isPublic = true;
    this.isSanitizedUpstreamError = true;
  }
}

export class CanvasPaginationError extends Error {
  constructor(message = 'Canvas pagination exceeded the configured safety limits') {
    super(message);
    this.name = 'CanvasPaginationError';
    this.code = 'CANVAS_PAGINATION_INVALID';
    this.status = 502;
    this.isPublic = true;
    this.isSanitizedUpstreamError = true;
  }
}

export class CanvasDeadlineError extends Error {
  constructor(message = 'Canvas request deadline exceeded', options) {
    super(message, options);
    this.name = 'CanvasDeadlineError';
    this.code = 'CANVAS_DEADLINE_EXCEEDED';
    this.status = 504;
    this.isPublic = true;
    this.isSanitizedUpstreamError = true;
  }
}

function abortReason(signal, fallback = new DOMException('Canvas request aborted', 'AbortError')) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : fallback;
}

function combineAbortSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return { signal: undefined, cleanup: () => {} };
  if (active.length === 1) return { signal: active[0], cleanup: () => {} };

  const controller = new AbortController();
  const listeners = active.map((signal) => {
    const onAbort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    return { signal, onAbort };
  });

  return {
    signal: controller.signal,
    cleanup: () => listeners.forEach(({ signal, onAbort }) => signal.removeEventListener('abort', onAbort)),
  };
}

function createOperationContext(requestOptions = {}) {
  const configuredTimeoutMs = canvasLimit('canvasOperationTimeoutMs', CANVAS_DEFAULT_OPERATION_TIMEOUT_MS);
  const timeoutMs = Math.min(
    configuredTimeoutMs,
    configuredPositiveInt(requestOptions.deadlineMs, configuredTimeoutMs),
  );
  const deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(new CanvasDeadlineError()), timeoutMs);
  const combined = combineAbortSignals([requestOptions.signal, deadlineController.signal]);

  return {
    signal: combined.signal,
    deadlineAt: Date.now() + timeoutMs,
    cleanup: () => {
      clearTimeout(timer);
      combined.cleanup();
    },
  };
}

function operationContextFrom(requestOptions = {}) {
  if (requestOptions.operationContext) {
    return { context: requestOptions.operationContext, ownsContext: false };
  }
  const inheritedSignal = requestOptions.signal || currentCanvasRequestSignal();
  return {
    context: createOperationContext({ ...requestOptions, signal: inheritedSignal }),
    ownsContext: true,
  };
}

function remainingOperationMs(context) {
  if (!context?.deadlineAt) return Number.POSITIVE_INFINITY;
  return Math.max(1, context.deadlineAt - Date.now());
}

const delayWithSignal = (delayMs, signal) => new Promise((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => {
    settled = true;
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, delayMs);
  const onAbort = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reject(abortReason(signal));
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
});

function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  let onAbort;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([promise, abortPromise]).finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}

function readHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value == null ? null : String(value);
  }
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key && headers[key] != null ? String(headers[key]) : null;
}

async function decodeBody(raw, contentEncoding, maxResponseBytes) {
  const encoding = String(contentEncoding || '').split(',')[0].trim().toLowerCase();
  if (!encoding || encoding === 'identity') return raw;
  let decoder;
  if (encoding === 'gzip' || encoding === 'x-gzip') decoder = createGunzip();
  else if (encoding === 'deflate') decoder = createInflate();
  else if (encoding === 'br') decoder = createBrotliDecompress();
  else return raw;

  const chunks = [];
  let outputBytes = 0;
  await new Promise((resolve, reject) => {
    decoder.on('data', (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxResponseBytes) {
        decoder.destroy(new CanvasResponseLimitError('Canvas response exceeded the decompressed size limit'));
        return;
      }
      chunks.push(chunk);
    });
    decoder.once('end', resolve);
    decoder.once('error', reject);
    decoder.end(raw);
  }).catch((error) => {
    if (error instanceof CanvasResponseLimitError) throw error;
    const stable = toStableUpstreamError(error, { serviceName: 'Canvas API' });
    stable.code = 'CANVAS_RESPONSE_DECODE_FAILED';
    stable.status = 502;
    stable.isPublic = true;
    throw stable;
  });
  return Buffer.concat(chunks);
}

function parseResponseBody(raw, response) {
  if (raw == null) return raw;
  if (!Buffer.isBuffer(raw)) return raw;
  const text = raw.toString('utf8');
  const contentType = readHeader(response?.headers, 'content-type') || '';
  if (/json/i.test(contentType) || /^[\s[{]/.test(text)) {
    try {
      return text.length ? JSON.parse(text) : null;
    } catch {
      // Preserve the bounded text for non-JSON Canvas error/proxy responses.
      return text;
    }
  }
  return text;
}

async function consumeCanvasBody(response, signal) {
  const maxCompressed = canvasLimit(
    'canvasMaxCompressedResponseBytes',
    CANVAS_DEFAULT_COMPRESSED_RESPONSE_BYTES,
  );
  const maxResponse = canvasLimit('canvasMaxResponseBytes', CANVAS_DEFAULT_RESPONSE_BYTES);
  const declaredLength = Number.parseInt(readHeader(response?.headers, 'content-length'), 10);
  if (Number.isSafeInteger(declaredLength) && declaredLength > maxCompressed) {
    response?.data?.destroy?.();
    throw new CanvasResponseLimitError('Canvas response exceeded the compressed size limit');
  }

  const body = response?.data;
  if (body && typeof body !== 'string' && !Buffer.isBuffer(body) && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let compressedBytes = 0;
    const onAbort = () => body.destroy?.(abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const iterator = body[Symbol.asyncIterator]();
      while (true) {
        const step = await awaitWithAbort(iterator.next(), signal);
        if (step.done) break;
        const chunk = step.value;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        compressedBytes += buffer.byteLength;
        if (compressedBytes > maxCompressed) {
          body.destroy?.();
          throw new CanvasResponseLimitError('Canvas response exceeded the compressed size limit');
        }
        chunks.push(buffer);
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    const decoded = await decodeBody(
      Buffer.concat(chunks),
      readHeader(response?.headers, 'content-encoding'),
      maxResponse,
    );
    if (decoded.byteLength > maxResponse) {
      throw new CanvasResponseLimitError('Canvas response exceeded the decompressed size limit');
    }
    return parseResponseBody(decoded, response);
  }

  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (raw.byteLength > maxCompressed) {
      throw new CanvasResponseLimitError('Canvas response exceeded the compressed size limit');
    }
    const decoded = await decodeBody(raw, readHeader(response?.headers, 'content-encoding'), maxResponse);
    if (decoded.byteLength > maxResponse) {
      throw new CanvasResponseLimitError('Canvas response exceeded the decompressed size limit');
    }
    return parseResponseBody(decoded, response);
  }

  // Mocks and callers may provide an already-decoded JSON object. Bound its
  // serialized representation before returning it to prevent an unbounded
  // object supplied by an adapter from escaping the service.
  if (body !== undefined) {
    let serialized;
    try {
      serialized = JSON.stringify(body);
    } catch {
      throw new CanvasResponseLimitError('Canvas response could not be bounded');
    }
    if (Buffer.byteLength(serialized || '') > maxResponse) {
      throw new CanvasResponseLimitError('Canvas response exceeded the decompressed size limit');
    }
  }
  return body;
}

function canvasRequestUrl(integration, endpoint) {
  const canvasOrigin = validateCanvasUrl(integration.canvasUrl).origin;
  if (/^https?:\/\//i.test(endpoint)) {
    const parsed = new URL(endpoint);
    if (parsed.origin !== canvasOrigin || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new CanvasPaginationError('Canvas pagination link must remain on the configured Canvas origin');
    }
    return { canvasOrigin, url: parsed.href };
  }
  if (endpoint.startsWith('/api/v1/')) {
    return { canvasOrigin, url: new URL(endpoint, canvasOrigin).href };
  }
  const apiRoot = new URL('/api/v1/', canvasOrigin);
  return { canvasOrigin, url: new URL(endpoint.replace(/^\//, ''), apiRoot).href };
}

/** Executes one bounded Canvas API request, returning mock data when test mode is enabled. */
const makeCanvasRequest = async (integration, method, endpoint, data = null, requestOptions = {}) => {
  const requestSignal = requestOptions.signal || currentCanvasRequestSignal();
  const perRequestTimeout = Math.max(
    1,
    Math.min(
      canvasLimit('canvasRequestTimeoutMs', CANVAS_DEFAULT_REQUEST_TIMEOUT_MS),
      remainingOperationMs(requestOptions.operationContext),
    ),
  );
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new CanvasDeadlineError('Canvas request deadline exceeded')),
    perRequestTimeout,
  );
  const combined = combineAbortSignals([requestSignal, timeoutController.signal]);

  try {
    if (data != null) {
      let bodySize;
      try {
        bodySize = Buffer.byteLength(JSON.stringify(data));
      } catch {
        throw new CanvasResponseLimitError('Canvas request body could not be bounded');
      }
      if (bodySize > canvasLimit('canvasMaxRequestBodyBytes', CANVAS_DEFAULT_REQUEST_BODY_BYTES)) {
        throw new CanvasResponseLimitError('Canvas request body exceeded the configured size limit');
      }
    }

    if (integration.isTestMode) {
      // Simulate API delay, while still honoring a disconnected caller/deadline.
      await delayWithSignal(300, combined.signal);

      // Return mock responses based on endpoint
      if (endpoint.includes('/courses') && method === 'GET' && !endpoint.includes('/quizzes')) {
        return { data: MOCK_CANVAS_COURSES, headers: {} };
      }
      if (endpoint.includes('/quizzes') && method === 'POST') {
        return { data: { id: Math.floor(Math.random() * 1000), title: data?.quiz?.title || 'Test Quiz' }, headers: {} };
      }
      if (endpoint.includes('/quizzes') && method === 'GET' && !endpoint.includes('/questions')) {
        return { data: [
          { id: 1, title: 'Test Quiz 1', quiz_type: 'assignment', published: false },
          { id: 2, title: 'Test Quiz 2', quiz_type: 'assignment', published: true }
        ], headers: {} };
      }
      if (endpoint.includes('/questions') && method === 'POST') {
        return { data: { id: Math.floor(Math.random() * 1000) }, headers: {} };
      }
      if (endpoint.includes('/questions') && method === 'GET') {
        const singleQuestionMatch = endpoint.match(/\/questions\/(\d+)$/);
        const singleQuestion = {
          id: 1,
          question_name: '1. Test Question',
          question_text: 'What is 2+2?\nA) 3\nB) 4\nC) 5\nD) 6',
          question_type: 'multiple_choice_question',
          position: 1,
          answers: [
            { id: 1, answer_text: '3', answer_weight: 0 },
            { id: 2, answer_text: '4', answer_weight: 100 },
            { id: 3, answer_text: '5', answer_weight: 0 },
            { id: 4, answer_text: '6', answer_weight: 0 }
          ]
        };
        if (singleQuestionMatch) {
          return { data: { ...singleQuestion, id: parseInt(singleQuestionMatch[1], 10) }, headers: {} };
        }
        return { data: [singleQuestion], headers: {} };
      }
      if (endpoint.includes('/quizzes') && method === 'GET' && endpoint.match(/\/quizzes\/\d+$/)) {
        const quizId = endpoint.match(/\/quizzes\/(\d+)$/)?.[1];
        return { data: { id: parseInt(quizId), title: 'Test Quiz', quiz_type: 'assignment', published: false }, headers: {} };
      }
      return { data: { success: true }, headers: {} };
    }

    // Real Canvas API request — re-validate at request time (#991) so an
    // integration saved before this guard existed, or one whose row was
    // altered directly, can't pivot the backend into an internal network or
    // cloud metadata endpoint.
    const { canvasOrigin, url } = canvasRequestUrl(integration, endpoint);
    const axiosConfig = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${integration.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: combined.signal,
      timeout: perRequestTimeout,
      responseType: 'stream',
      // Count raw wire bytes ourselves before decoding, then enforce the
      // decompressed cap while consuming the bounded stream.
      decompress: false,
      maxContentLength: canvasLimit(
        'canvasMaxCompressedResponseBytes',
        CANVAS_DEFAULT_COMPRESSED_RESPONSE_BYTES,
      ),
      maxBodyLength: canvasLimit('canvasMaxRequestBodyBytes', CANVAS_DEFAULT_REQUEST_BODY_BYTES),
      lookup: createPinnedLookup(),
      maxRedirects: 5,
      beforeRedirect: (redirectOptions) => {
        const { protocol, hostname, port } = redirectOptions;
        const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
        const redirectOrigin = validateCanvasUrl(`${protocol}//${host}${port ? `:${port}` : ''}`).origin;
        if (redirectOrigin !== canvasOrigin && redirectOptions.headers) {
          for (const headerName of Object.keys(redirectOptions.headers)) {
            if (headerName.toLowerCase() === 'authorization') {
              delete redirectOptions.headers[headerName];
            }
          }
        }
      }
    };

    if (data != null) axiosConfig.data = data;

    try {
      const axiosPromise = axios(axiosConfig);
      // Axios normally observes `signal`; racing here also makes the service
      // bounded when a test adapter or custom transport forgets to do so.
      const response = await awaitWithAbort(axiosPromise, combined.signal);
      response.data = await consumeCanvasBody(response, combined.signal);
      return response;
    } catch (error) {
      if (combined.signal?.aborted) {
        // Preserve an explicit caller reason (including an AbortError) rather
        // than replacing it with a generic upstream body/message.
        if (requestSignal?.aborted) throw abortReason(requestSignal, error);
        if (timeoutController.signal.aborted) throw abortReason(timeoutController.signal, error);
      }
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
        throw new CanvasDeadlineError('Canvas request deadline exceeded', { cause: error });
      }
      error?.response?.data?.destroy?.();
      throw toStableUpstreamError(error, { serviceName: 'Canvas API' });
    }
  } finally {
    clearTimeout(timeout);
    combined.cleanup();
  }
};

function isCancellationError(error) {
  return error?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || error?.name === 'CanvasDeadlineError';
}

function rethrowCanvasServiceError(prefix, error) {
  if (isCancellationError(error) || error?.name === 'CanvasPaginationError' || error?.name === 'CanvasResponseLimitError') {
    throw error;
  }
  const wrapped = new Error(`${prefix}: ${error?.message || 'Canvas request failed'}`, { cause: error });
  if (error?.statusCode != null) wrapped.statusCode = error.statusCode;
  if (error?.status != null) wrapped.status = error.status;
  if (error?.code?.startsWith?.('CANVAS_')) wrapped.code = error.code;
  if (error?.isPublic) wrapped.isPublic = true;
  if (error?.isSanitizedUpstreamError) wrapped.isSanitizedUpstreamError = true;
  throw wrapped;
}

function normalizeCollectionData(data) {
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

function nextLinkFrom(response) {
  const header = readHeader(response?.headers, 'link');
  if (!header) return null;
  // Canvas emits RFC 8288 links. Parse only the `next` relation and ignore
  // malformed entries rather than treating an arbitrary URL as a page.
  const expression = /<([^>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^,;\s]+))/gi;
  let match;
  while ((match = expression.exec(header)) !== null) {
    const relations = (match[2] || match[3] || match[4] || '').split(/\s+/);
    if (relations.some((relation) => relation.toLowerCase() === 'next')) return match[1];
  }
  if (/\brel\s*=\s*["']?[^,;"']*\bnext\b/i.test(header)) {
    throw new CanvasPaginationError('Canvas returned a malformed next pagination link');
  }
  return null;
}

function validateNextCanvasUrl(integration, next, previousUrl) {
  let parsed;
  try {
    parsed = new URL(next, previousUrl);
  } catch {
    throw new CanvasPaginationError('Canvas returned an invalid pagination link');
  }
  const canvasOrigin = validateCanvasUrl(integration.canvasUrl).origin;
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== canvasOrigin ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith('/api/v1/')
  ) {
    throw new CanvasPaginationError('Canvas pagination link must remain on the configured Canvas API origin');
  }
  // Re-run the hostname/IP-literal guard on every hop, not just the persisted
  // integration URL. DNS pinning in makeCanvasRequest covers rebinding.
  validateCanvasUrl(`${parsed.origin}/`);
  return parsed.href;
}

async function fetchCanvasCollection(integration, endpoint, requestOptions = {}) {
  const { context, ownsContext } = operationContextFrom(requestOptions);
  const configuredMaxPages = canvasLimit('canvasMaxPages', CANVAS_DEFAULT_MAX_PAGES);
  const configuredMaxItems = canvasLimit('canvasMaxItems', CANVAS_DEFAULT_MAX_ITEMS);
  const maxPages = Math.min(configuredMaxPages, configuredPositiveInt(requestOptions.maxPages, configuredMaxPages));
  const maxItems = Math.min(configuredMaxItems, configuredPositiveInt(requestOptions.maxItems, configuredMaxItems));
  const aggregate = [];
  const seen = new Set();
  let current = endpoint;
  let pageCount = 0;

  try {
    while (current) {
      if (context.signal?.aborted) throw abortReason(context.signal);
      if (pageCount >= maxPages) {
        throw new CanvasPaginationError('Canvas pagination exceeded the maximum page limit');
      }

      const { url } = canvasRequestUrl(integration, current);
      if (seen.has(url)) throw new CanvasPaginationError('Canvas pagination link cycle detected');
      seen.add(url);

      const response = await makeCanvasRequest(integration, 'GET', current, null, {
        signal: context.signal,
        operationContext: context,
      });
      pageCount += 1;

      const pageItems = normalizeCollectionData(response.data);
      if (aggregate.length + pageItems.length > maxItems) {
        throw new CanvasPaginationError('Canvas pagination exceeded the maximum item limit');
      }
      aggregate.push(...pageItems);

      const next = nextLinkFrom(response);
      current = next ? validateNextCanvasUrl(integration, next, url) : null;
    }

    return aggregate;
  } finally {
    if (ownsContext) context.cleanup();
  }
}

/** Lists Canvas courses available to the instructor, or mock courses in test mode. */
export const getCanvasCourses = async (userId, requestOptions = {}) => {
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    if (integration.isTestMode) return MOCK_CANVAS_COURSES;

    return await fetchCanvasCollection(
      integration,
      '/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment',
      requestOptions,
    );
  } catch (error) {
    rethrowCanvasServiceError('Failed to get Canvas courses', error);
  }
};

/**
 * Exports an assessment’s sections/variants to Canvas as a quiz and stores the mapping.
 *
 * `callerId` owns the personal Canvas integration (credentials are per-user, §18);
 * `ownerId` (the authorized course's owner) scopes the assessment lookup and the
 * stored course mapping, so a non-owner instructor/UNIT_ADMIN can export into a
 * course they have access to without their personal creds leaking into the mapping.
 */
export const exportAssessmentToCanvas = async (
  callerId,
  assessmentId,
  canvasCourseId,
  ownerId = callerId,
  requestOptions = {},
) => {
  const { context, ownsContext } = operationContextFrom(requestOptions);
  try {
    const integration = await getCanvasIntegration(callerId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    // Get the assessment with all its questions
    const assessment = await getAssessmentById(assessmentId, ownerId);

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    // Get all questions from sections
    const questions = [];
    if (assessment.sections && assessment.sections.length > 0) {
      for (const section of assessment.sections) {
        if (section.sectionVariants && section.sectionVariants.length > 0) {
          for (const sectionVariant of section.sectionVariants) {
            const variant = sectionVariant.variant;
            if (variant) {
              questions.push({
                variant,
                sectionName: section.name,
                displayOrder: sectionVariant.displayOrder,
              });
            }
          }
        }
      }
    }

    if (questions.length === 0) {
      throw new Error("Assessment has no questions to export");
    }

    const canvasCoursePathSegment = canvasPathSegment(canvasCourseId, 'Canvas course ID');

    // Create quiz in Canvas
    const quizData = {
      quiz: {
        title: assessment.name,
        description: assessment.description || `Exported from Question Maker - ${assessment.type}`,
        quiz_type: "assignment",
        published: false, // Don't publish automatically
        show_correct_answers: true,
        allowed_attempts: 1,
      },
    };

    const quizResponse = await makeCanvasRequest(
      integration,
      'POST',
      `/courses/${canvasCoursePathSegment}/quizzes`,
      quizData,
      { signal: context.signal, operationContext: context },
    );

    const quizId = quizResponse.data.id;
    const quizPathSegment = canvasPathSegment(quizId, 'Canvas quiz ID');

    // Create questions in Canvas
    const createdQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const { variant, sectionName } = questions[i];
      const questionMetadata = variant.questionMetadata;

      if (!questionMetadata) continue;

      const canvasQuestion = convertVariantToCanvasQuestion(
        variant,
        questionMetadata,
        i + 1,
        sectionName,
      );

      const questionResponse = await makeCanvasRequest(
        integration,
        'POST',
        `/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}/questions`,
        { question: canvasQuestion },
        { signal: context.signal, operationContext: context },
      );

      createdQuestions.push(questionResponse.data);
    }

    // Save course mapping if it doesn't exist (mapping is course-scoped → owner-keyed).
    const courseMapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId: assessment.courseId,
      },
    });

    if (!courseMapping) {
      await prisma.canvasCourseMapping.create({
        data: {
          userId: ownerId,
          localCourseId: assessment.courseId,
          canvasCourseId,
          canvasCourseName: integration.isTestMode ? "Test Course" : undefined,
        },
      });
    }

    return {
      quizId,
      quizTitle: quizResponse.data.title,
      questionsCreated: createdQuestions.length,
      canvasUrl: integration.isTestMode 
        ? `[TEST MODE] Quiz would be created at: ${integration.canvasUrl}/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}`
        : `${integration.canvasUrl}/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}`
    };
  } catch (error) {
    rethrowCanvasServiceError('Failed to export assessment to Canvas', error);
  } finally {
    if (ownsContext) context.cleanup();
  }
};

/** Converts a local variant into a Canvas quiz question payload (MCQ/SA/LA supported). */
const convertVariantToCanvasQuestion = (variant, questionMetadata, position, sectionName) => {
  void sectionName;
  const questionText = variant.questionText || '';
  const answerText = variant.answer || '';
  const isMCQ = questionMetadata.type === 'MCQ';
  const isLongAnswer = questionMetadata.type === 'LA';
  
  const baseQuestion = {
    question_name: `${position}. ${questionMetadata.description || "Question"}`,
    question_text: questionText,
    points_possible: 1,
    position: position,
  };

  if (isMCQ) {
    // Use choices array if available, otherwise fallback to parsing from questionText
    let options = [];

    if (variant.choices && Array.isArray(variant.choices) && variant.choices.length > 0) {
      // Use choices array directly
      const correctLetter = answerText ? answerText.trim().toUpperCase().charAt(0) : null;
      options = variant.choices.map((choice) => ({
        text: choice.text,
        letter: choice.letter,
        isCorrect: choice.letter === correctLetter,
      }));
    } else {
      // Fallback to parsing from questionText for legacy data
      options = parseMCQOptions(questionText, answerText);
    }

    return {
      ...baseQuestion,
      question_type: "multiple_choice_question",
      answers: options.map((option) => ({
        answer_text: option.text,
        answer_weight: option.isCorrect ? 100 : 0,
        answer_comment: option.isCorrect ? "Correct!" : "",
      })),
    };
  } else {
    // Long/short answer question
    return {
      ...baseQuestion,
      question_type: isLongAnswer ? "essay_question" : "short_answer_question",
      answers: [
        {
          answer_text: answerText || "Sample answer",
          answer_weight: 100,
        },
      ],
    };
  }
};

/** Parses MCQ options from the variant text and flags the correct answer letter if present. */
const parseMCQOptions = (questionText, answerText) => {
  const lines = questionText.split("\n");
  const options = [];

  // Extract the correct answer letter from answer text
  let correctAnswerLetter = null;
  if (answerText) {
    const answerMatch = answerText.match(/^([A-D])\)?/);
    if (answerMatch) {
      correctAnswerLetter = answerMatch[1];
    }
  }

  // Parse options from question text
  for (const line of lines) {
    const match = line.match(/^([A-D])\)\s*(.+)$/);
    if (match) {
      const letter = match[1];
      const text = match[2].trim();
      options.push({
        text,
        letter,
        isCorrect: letter === correctAnswerLetter,
      });
    }
  }

  // If no options found, create default options
  if (options.length === 0) {
    return [
      { text: "Option A", isCorrect: correctAnswerLetter === "A" },
      { text: "Option B", isCorrect: correctAnswerLetter === "B" || !correctAnswerLetter },
      { text: "Option C", isCorrect: correctAnswerLetter === "C" },
      { text: "Option D", isCorrect: correctAnswerLetter === "D" },
    ];
  }

  // Sort options by letter (A, B, C, D)
  options.sort((a, b) => a.letter.localeCompare(b.letter));

  return options;
};

/**
 * Returns the stored Canvas course mapping for a local course. `userId` is
 * unused in the lookup itself (kept for call-site compatibility) — a mapping
 * is 1:1 with the course, not scoped per-user, so any authorized caller sees
 * the same mapping a co-instructor created.
 */
export const getCanvasCourseMapping = async (userId, localCourseId) => {
  try {
    const mapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId,
      },
    });

    return mapping;
  } catch (error) {
    throw new Error(`Failed to get Canvas course mapping: ${error.message}`);
  }
};

/** Lists quizzes from a Canvas course, filtering to assignment-style quizzes. */
export const getCanvasQuizzes = async (userId, canvasCourseId, requestOptions = {}) => {
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    const canvasCoursePathSegment = canvasPathSegment(canvasCourseId, 'Canvas course ID');

    // Filter to only return assignment-type quizzes (what we export), after
    // aggregating every bounded Canvas Link page.
    const quizzes = await fetchCanvasCollection(
      integration,
      `/courses/${canvasCoursePathSegment}/quizzes`,
      requestOptions,
    );
    return quizzes.filter(quiz => quiz.quiz_type === 'assignment' || quiz.quiz_type === 'graded_survey');
  } catch (error) {
    rethrowCanvasServiceError('Failed to get Canvas quizzes', error);
  }
};

// Debug prefix for Canvas import troubleshooting (grep for this to see all import logs)
const DEBUG_PREFIX = "[Canvas Import]";

/** Fetches the question list for a Canvas quiz. Note: list endpoint often returns answers as null; use getCanvasQuizQuestionById for full details. */
export const getCanvasQuizQuestions = async (userId, canvasCourseId, quizId, requestOptions = {}) => {
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    const canvasCoursePathSegment = canvasPathSegment(canvasCourseId, 'Canvas course ID');
    const quizPathSegment = canvasPathSegment(quizId, 'Canvas quiz ID');

    const list = await fetchCanvasCollection(
      integration,
      `/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}/questions`,
      requestOptions,
    );
    const firstAnswerCount = Array.isArray(list[0]?.answers) ? list[0].answers.length : 0;
    console.log(`${DEBUG_PREFIX} quiz question list received`, {
      questionCount: list.length,
      firstAnswerCount,
    });
    return list;
  } catch (error) {
    rethrowCanvasServiceError('Failed to get Canvas quiz questions', error);
  }
};

/** Fetches a single Canvas quiz question by ID, including the answers array (required for MCQ choices and correct answer). */
export const getCanvasQuizQuestionById = async (userId, canvasCourseId, quizId, questionId, requestOptions = {}) => {
  const { context, ownsContext } = operationContextFrom(requestOptions);
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    const canvasCoursePathSegment = canvasPathSegment(canvasCourseId, 'Canvas course ID');
    const quizPathSegment = canvasPathSegment(quizId, 'Canvas quiz ID');
    const questionPathSegment = canvasPathSegment(questionId, 'Canvas question ID');

    const response = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}/questions/${questionPathSegment}`,
      null,
      { signal: context.signal, operationContext: context },
    );

    const data = response.data;

    // Some Canvas API responses wrap the question in a 'question' key
    const question = (data && typeof data === 'object' && data.question != null) ? data.question : data;
    const answers = question?.answers;
    console.log(`${DEBUG_PREFIX} quiz question detail received`, {
      answerCount: Array.isArray(answers) ? answers.length : 0,
    });
    return question;
  } catch (error) {
    rethrowCanvasServiceError('Failed to get Canvas quiz question', error);
  } finally {
    if (ownsContext) context.cleanup();
  }
};

/** Removes Canvas HTML markup from question text while preserving logical line breaks. */
const stripHtmlTags = (html) => {
  if (!html || typeof html !== "string") return "";

  let text = html;

  // Replace block-level elements with line breaks
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&[#\w]+;/g, "");

  // Normalize whitespace: collapse multiple spaces, preserve single newlines
  text = text
    .replace(/[ \t]+/g, " ") // Collapse spaces and tabs
    .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
    .replace(/[ \t]*\n[ \t]*/g, "\n") // Remove spaces around newlines
    .trim();

  return text;
};

/** Normalize Canvas question_type for comparison (align with export types). */
const normalizeCanvasQuestionType = (questionType) => {
  if (questionType == null) return "";
  return String(questionType).toLowerCase().trim();
};

/** Canvas API uses either answer_text/answer_weight (docs) or text/weight (submission/list API). Normalize to one shape. */
const getCanvasAnswerText = (ans) => ans?.answer_text ?? ans?.text ?? "";
const getCanvasAnswerWeight = (ans) => {
  const w = ans?.answer_weight ?? ans?.weight;
  return w != null ? Number(w) : null;
};
const isCanvasAnswerCorrect = (ans) => {
  const w = getCanvasAnswerWeight(ans);
  return w === 100 || (w != null && w > 0);
};

/**
 * Parses MCQ choices from question text when Canvas returns answers as null.
 * Handles formats like "Question text\nA) Option A\nB) Option B\nC) Option C\nD) Option D".
 * Returns { questionText: string, choices: Array<{letter: string, text: string}> }.
 */
const parseChoicesFromQuestionText = (questionText) => {
  if (!questionText || typeof questionText !== "string") {
    return { questionText: questionText || "", choices: [] };
  }
  const lines = questionText.split("\n");
  const choices = [];
  const questionLines = [];
  const choicePattern = /^([A-Za-z])\)\s*(.+)$/;
  let foundChoices = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(choicePattern);
    if (match) {
      foundChoices = true;
      choices.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
    } else if (trimmedLine && !foundChoices) {
      questionLines.push(line);
    }
  }
  const cleanQuestionText = questionLines.join("\n").trim();
  return {
    questionText: cleanQuestionText || questionText,
    choices,
  };
};

/** Converts a Canvas question into local variant metadata, throwing for unsupported types. */
const convertCanvasQuestionToVariant = (canvasQuestion) => {
  const questionTypeRaw = canvasQuestion.question_type;
  const questionType = normalizeCanvasQuestionType(questionTypeRaw);
  const questionTextRaw = canvasQuestion.question_text || "";
  const questionName = canvasQuestion.question_name || "";

  const answersInput = canvasQuestion.answers;
  console.log(`${DEBUG_PREFIX} converting Canvas question`, {
    answerCount: Array.isArray(answersInput) ? answersInput.length : 0,
    questionTextLength: questionTextRaw.length,
  });

  // Extract description from question name first (used in all return paths)
  const descriptionMatch = questionName.match(/^\d+\.\s*(.+)$/);
  const description = descriptionMatch
    ? descriptionMatch[1].trim()
    : (questionName || "Imported Question").trim();

  // Strip HTML tags from question text
  const questionText = stripHtmlTags(questionTextRaw);

  let localType = "SA";
  let processedQuestionText = questionText;
  let answer = null;
  let choices = null;

  // Match export types: multiple_choice_question, true_false_question, essay_question, short_answer_question
  if (questionType === "multiple_choice_question" || questionType === "true_false_question") {
    localType = "MCQ";
    const answers = canvasQuestion.answers || [];
    const choicesList = [];
    let correctLetter = null;

    if (answers.length > 0) {
      console.log(`${DEBUG_PREFIX} using Canvas answer array`, {
        answerCount: answers.length,
      });
      const correctAnswer = answers.find((a) => isCanvasAnswerCorrect(a));

      if (questionType === "true_false_question") {
        choicesList.push({ letter: "A", text: "True" });
        choicesList.push({ letter: "B", text: "False" });
        if (correctAnswer) {
          const text = stripHtmlTags(getCanvasAnswerText(correctAnswer)).trim();
          correctLetter = text.toLowerCase() === "true" ? "A" : "B";
        }
      } else {
        const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
        answers.forEach((ans, index) => {
          const letter = letters[index];
          const answerText = stripHtmlTags(getCanvasAnswerText(ans));
          choicesList.push({ letter, text: answerText });
          if (isCanvasAnswerCorrect(ans)) {
            correctLetter = letter;
          }
        });
      }

      processedQuestionText = questionText.trim();
      if (correctLetter) {
        answer = correctLetter;
      } else if (correctAnswer) {
        const text = stripHtmlTags(getCanvasAnswerText(correctAnswer));
        const letterMatch = text.match(/^([A-Za-z])/);
        answer = letterMatch ? letterMatch[1].toUpperCase() : null;
      }
      choices = choicesList.length > 0 ? choicesList : null;
    }

    // Fallback: when Canvas returns answers as null/empty (common for list or some instances), parse choices from question_text
    if (choices == null && questionType === "multiple_choice_question") {
      const parsed = parseChoicesFromQuestionText(questionText);
      console.log(`${DEBUG_PREFIX} parsed choices from Canvas question text`, {
        choiceCount: parsed.choices.length,
      });
      if (parsed.choices.length > 0) {
        processedQuestionText = parsed.questionText;
        choices = parsed.choices;
        console.log(`${DEBUG_PREFIX} Canvas MCQ fallback completed`, {
          choiceCount: choices.length,
        });
        // answer stays null; user can set correct answer after import
      } else {
        console.log(
          `${DEBUG_PREFIX} convertCanvasQuestionToVariant: fallback found no choices (pattern A) B) etc. not matched)`,
        );
      }
    } else if (choices != null) {
      console.log(`${DEBUG_PREFIX} Canvas MCQ conversion completed`, {
        choiceCount: choices.length,
      });
    }

    return {
      questionText: processedQuestionText,
      answer: answer,
      choices,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  if (questionType === "essay_question") {
    localType = "LA";
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  if (
    questionType === "short_answer_question" ||
    questionType === "fill_in_multiple_blanks_question"
  ) {
    localType = "SA";
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  throw new Error(`Unsupported question type: ${questionTypeRaw ?? "unknown"}`);
};

/**
 * Imports a Canvas quiz into a local assessment, creating sections/questions/variants.
 *
 * `callerId` owns the personal Canvas integration and authors the imported rows
 * (`createdBy`); `ownerId` (the authorized course's owner) scopes the local-course
 * lookup and the created assessment/section, so a non-owner instructor can import
 * into a course they have access to.
 */
export const importQuizFromCanvas = async (
  callerId,
  canvasCourseId,
  quizId,
  localCourseId,
  options = {},
  ownerId = callerId,
  requestOptions = {},
) => {
  const { context, ownsContext } = operationContextFrom(requestOptions);
  try {
    const integration = await getCanvasIntegration(callerId);

    if (!integration) {
      throw new Error(
        "Canvas integration not configured. Please connect your Canvas account first.",
      );
    }

    // Verify local course exists and is accessible (owner-scoped). Existence
    // check only — `Course` has no local name to select anymore (#1072 §4 step 10).
    const course = await prisma.course.findFirst({
      where: { id: localCourseId, userId: ownerId },
      select: { id: true },
    });

    if (!course) {
      throw new Error("Local course not found");
    }

    const canvasCoursePathSegment = canvasPathSegment(canvasCourseId, 'Canvas course ID');
    const quizPathSegment = canvasPathSegment(quizId, 'Canvas quiz ID');

    // Get quiz details
    const quizResponse = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCoursePathSegment}/quizzes/${quizPathSegment}`,
      null,
      { signal: context.signal, operationContext: context },
    );
    const quiz = quizResponse.data;

    // Get quiz questions
    const canvasQuestions = await getCanvasQuizQuestions(callerId, canvasCourseId, quizId, {
      signal: context.signal,
      operationContext: context,
    });

    if (canvasQuestions.length === 0) {
      throw new Error("Quiz has no questions to import");
    }

    // Determine assessment type from options or default
    const assessmentType = options.assessmentType || "Quiz";
    const assessmentName = options.assessmentName || quiz.title || "Imported Quiz";

    // Create assessment (owner-scoped). Semester is derived from the course's
    // Core term (#1072 §4 step 8 / #1077) — no longer accepted from options.
    const assessment = await createAssessment(ownerId, {
      type: assessmentType,
      name: assessmentName,
      courseId: localCourseId,
      description: quiz.description || `Imported from Canvas: ${quiz.title}`,
    });

    // Create a default section for all questions
    const section = await createAssessmentSection(assessment.id, ownerId, {
      name: "Imported Questions",
      description: "Questions imported from Canvas",
      position: 0,
    });

    // Convert and import questions with graceful error handling
    const importedQuestions = [];
    const skippedQuestions = [];
    const primaryTopicId = options.primaryTopicId || null;

    if (!primaryTopicId) {
      throw new Error(
        "Primary topic ID is required for importing questions. Please select a topic.",
      );
    }

    for (let i = 0; i < canvasQuestions.length; i++) {
      const listItem = canvasQuestions[i];
      const questionId = listItem.id;

      console.log(`${DEBUG_PREFIX} processing Canvas question`, {
        questionIndex: i + 1,
        questionCount: canvasQuestions.length,
        answerCount: Array.isArray(listItem?.answers) ? listItem.answers.length : 0,
      });

      // Declared outside the try so the catch can still describe the question it skipped.
      let canvasQuestion = listItem;

      try {
        // Fetch full question by ID so we get the answers array (list endpoint often returns answers: null)
        if (questionId != null) {
          try {
            canvasQuestion = await getCanvasQuizQuestionById(callerId, canvasCourseId, quizId, questionId, {
              signal: context.signal,
              operationContext: context,
            });
            // Preserve position from list if full question doesn't have it
            if (canvasQuestion.position == null && listItem.position != null) {
              canvasQuestion = { ...canvasQuestion, position: listItem.position };
            }
            console.log(`${DEBUG_PREFIX} Canvas question detail fetched`, {
              questionIndex: i + 1,
              answerCount: Array.isArray(canvasQuestion?.answers) ? canvasQuestion.answers.length : 0,
            });
          } catch (error) {
            if (
              isCancellationError(error) ||
              error?.name === 'CanvasPaginationError' ||
              error?.name === 'CanvasResponseLimitError'
            ) {
              throw error;
            }
            console.log(`${DEBUG_PREFIX} Canvas question detail fetch failed`, {
              questionIndex: i + 1,
            });
            // Fall back to list item if per-question fetch fails (e.g. permissions)
            canvasQuestion = listItem;
          }
        }

        // Try to convert the question - this will throw if unsupported
        const converted = convertCanvasQuestionToVariant(canvasQuestion);
        console.log(`${DEBUG_PREFIX} Canvas question converted`, {
          questionIndex: i + 1,
          choiceCount: Array.isArray(converted.choices) ? converted.choices.length : 0,
        });

        // Create question metadata
        const questionMetadata = await prisma.questionMetadata.create({
          data: {
            courseId: localCourseId,
            primaryTopicId: primaryTopicId,
            type: converted.type,
            description: converted.description,
            questionOrder: {},
            createdBy: callerId,
          },
        });

        // Create variant
        console.log(`${DEBUG_PREFIX} creating Canvas question variant`, {
          choiceCount: Array.isArray(converted.choices) ? converted.choices.length : 0,
        });
        const variant = await prisma.variants.create({
          data: {
            questionMetadataId: questionMetadata.id,
            questionText: converted.questionText,
            difficulty: "medium", // Default difficulty
            answer: converted.answer,
            choices: converted.choices || null, // Include choices for MCQ
            assessmentId: assessment.id,
            secondaryTopicsId: [],
            isAiGenerated: false,
            isDraft: true, // Mark as draft for review
            createdBy: callerId,
          },
        });

        // Link variant to section
        await prisma.sectionVariants.create({
          data: {
            sectionId: section.id,
            variantId: variant.id,
            displayOrder: converted.position || i,
          },
        });

        importedQuestions.push({
          questionMetadataId: questionMetadata.id,
          variantId: variant.id,
        });
      } catch (error) {
        // Transport/deadline/limit failures invalidate the whole import. Do
        // not turn an aborted or bounded pagination operation into a seemingly
        // successful partial assessment by recording it as a skipped item.
        if (
          isCancellationError(error) ||
          error?.name === 'CanvasPaginationError' ||
          error?.name === 'CanvasResponseLimitError'
        ) {
          throw error;
        }
        // If conversion or creation fails, skip this question but continue
        const questionName = canvasQuestion.question_name || `Question ${i + 1}`;
        const questionType = canvasQuestion.question_type || "unknown";
        skippedQuestions.push({
          position: canvasQuestion.position || i + 1,
          name: questionName,
          type: questionType,
          reason: error.message || "Unknown error",
        });
        // Continue to next question
        continue;
      }
    }

    // If no questions were imported at all, throw an error
    if (importedQuestions.length === 0) {
      throw new Error("No questions could be imported. All question types may be unsupported.");
    }

    // Save course mapping if it doesn't exist (mapping is course-scoped → owner-keyed).
    const courseMapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId: localCourseId,
      },
    });

    if (!courseMapping) {
      await prisma.canvasCourseMapping.create({
        data: {
          userId: ownerId,
          localCourseId: localCourseId,
          canvasCourseId: canvasCourseId,
          canvasCourseName: integration.isTestMode ? "Test Course" : undefined,
        },
      });
    }

    return {
      assessmentId: assessment.id,
      assessmentName: assessment.name,
      questionsImported: importedQuestions.length,
      questionsSkipped: skippedQuestions.length,
      skippedQuestions: skippedQuestions,
      sectionId: section.id,
    };
  } catch (error) {
    rethrowCanvasServiceError('Failed to import quiz from Canvas', error);
  } finally {
    if (ownsContext) context.cleanup();
  }
};

/** Lists Classic Canvas Assessment Question Banks for a course. */
export const getCanvasQuestionBanks = async (userId, canvasCourseId) => {
  const integration = await getCanvasIntegration(userId);
  if (!integration) {
    throw new Error("Canvas integration not configured. Please connect your Canvas account first.");
  }

  const courseId = parseCanvasNumericId(canvasCourseId, "canvasCourseId");
  const response = await makeCanvasRequest(
    integration,
    "GET",
    `/question_banks?context_type=Course&context_id=${encodeURIComponent(String(courseId))}&include_question_count=true`,
  );
  const banks = Array.isArray(response.data) ? response.data : [response.data];
  return banks.filter(Boolean);
};

/** Fetches a single Canvas question bank. */
export const getCanvasQuestionBank = async (userId, canvasBankId) => {
  const integration = await getCanvasIntegration(userId);
  if (!integration) {
    throw new Error("Canvas integration not configured. Please connect your Canvas account first.");
  }

  const bankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
  const response = await makeCanvasRequest(
    integration,
    "GET",
    `/question_banks/${encodeURIComponent(String(bankId))}?include_question_count=true`,
  );
  return response.data;
};

/**
 * Lists assessment questions in a Canvas question bank (follows page query when provided).
 * @returns {{ questions: object[], truncated: boolean }}
 */
export const getCanvasQuestionBankQuestions = async (userId, canvasBankId, opts = {}) => {
  const integration = await getCanvasIntegration(userId);
  if (!integration) {
    throw new Error("Canvas integration not configured. Please connect your Canvas account first.");
  }

  const bankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
  const page = opts.page || 1;
  const perPage = opts.perPage || 100;
  const all = [];
  let currentPage = page;
  let truncated = false;

  for (;;) {
    const response = await makeCanvasRequest(
      integration,
      "GET",
      `/question_banks/${encodeURIComponent(String(bankId))}/questions?per_page=${perPage}&page=${currentPage}`,
    );
    const batch = Array.isArray(response.data) ? response.data : [response.data].filter(Boolean);
    all.push(...batch);
    if (integration.isTestMode || batch.length < perPage) {
      break;
    }
    currentPage += 1;
    if (currentPage > 50) {
      truncated = true;
      logger.warn(
        { canvasBankId: bankId, fetched: all.length, pageCap: 50 },
        "Canvas question bank fetch hit 50-page cap; results truncated",
      );
      break;
    }
  }

  return { questions: all, truncated };
};

/**
 * Imports / re-syncs a Canvas Assessment Question Bank into a Core-backed local course bank.
 */
export const importQuestionBankFromCanvas = async (
  userId,
  canvasCourseId,
  canvasBankId,
  localCourseId,
  options = {},
  ownerId = userId,
) => {
  // Dynamic import avoids a static cycle: questionService → questionBankService
  // and this module → questionBankService (and createQuestion from questionService).
  const { listBanks, createBank, addQuestionsToBank } = await import("./questionBankService.js");

  const integration = await getCanvasIntegration(userId);
  if (!integration) {
    throw new Error("Canvas integration not configured. Please connect your Canvas account first.");
  }

  const parsedCanvasCourseId = parseCanvasNumericId(canvasCourseId, "canvasCourseId");
  const parsedCanvasBankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
  const parsedLocalCourseId = Number(localCourseId);
  const course = await prisma.course.findFirst({
    where: { id: parsedLocalCourseId, userId: ownerId },
    select: { id: true, coreCourseId: true, userId: true },
  });
  if (!course) {
    const err = new Error("Local course not found");
    err.status = 404;
    throw err;
  }

  // Banks may only sync into the local course that was linked from Canvas.
  const courseCanvasMapping = await prisma.canvasCourseMapping.findUnique({
    where: { localCourseId: parsedLocalCourseId },
    select: { canvasCourseId: true, localCourseId: true },
  });
  if (!courseCanvasMapping) {
    const err = new Error(
      "Course is not linked to Canvas. Sync the course from Canvas before importing question banks.",
    );
    err.status = 400;
    throw err;
  }
  if (Number(courseCanvasMapping.canvasCourseId) !== parsedCanvasCourseId) {
    const err = new Error(
      "canvasCourseId does not match the Canvas course linked to this local course",
    );
    err.status = 400;
    throw err;
  }

  const primaryTopicId =
    typeof options.primaryTopicId === "string" && options.primaryTopicId.trim()
      ? options.primaryTopicId.trim()
      : null;
  if (!primaryTopicId) {
    throw new Error("Primary topic ID is required for importing questions. Please select a topic.");
  }

  // One Canvas bank → one local course per instructor.
  const existingMapping = await prisma.canvasBankMapping.findUnique({
    where: {
      userId_canvasBankId: {
        userId,
        canvasBankId: parsedCanvasBankId,
      },
    },
  });
  if (existingMapping && Number(existingMapping.localCourseId) !== parsedLocalCourseId) {
    const err = new Error("This Canvas question bank is already synced to another local course");
    err.status = 400;
    throw err;
  }

  const remoteBank = await getCanvasQuestionBank(userId, parsedCanvasBankId);
  const { questions: remoteQuestions, truncated } = await getCanvasQuestionBankQuestions(
    userId,
    parsedCanvasBankId,
  );

  const banks = await listBanks(parsedLocalCourseId, userId);
  let localBank = null;

  if (options.targetBankId) {
    const targetId = String(options.targetBankId);
    localBank = banks.find((b) => b.id === targetId) || null;
    if (!localBank) {
      const err = new Error("Target bank not found in this course");
      err.status = 400;
      throw err;
    }
  } else if (existingMapping) {
    localBank = banks.find((b) => b.id === String(existingMapping.localBankId)) || null;
  }

  if (!localBank) {
    const title =
      (remoteBank && (remoteBank.title || remoteBank.name)) || `Canvas bank ${parsedCanvasBankId}`;
    localBank = await createBank(parsedLocalCourseId, userId, {
      name: String(title).trim() || "Imported bank",
    });
  }

  const bankMapping = await prisma.canvasBankMapping.upsert({
    where: {
      userId_canvasBankId: {
        userId,
        canvasBankId: parsedCanvasBankId,
      },
    },
    create: {
      userId,
      localCourseId: parsedLocalCourseId,
      localBankId: String(localBank.id),
      canvasCourseId: parsedCanvasCourseId,
      canvasBankId: parsedCanvasBankId,
      lastSyncedAt: null,
    },
    update: {
      localBankId: String(localBank.id),
      canvasCourseId: parsedCanvasCourseId,
      localCourseId: parsedLocalCourseId,
    },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const membershipIds = [];

  for (const remote of remoteQuestions) {
    const canvasAssessmentQuestionId = remote?.id;
    if (canvasAssessmentQuestionId == null) {
      skipped += 1;
      continue;
    }

    let converted;
    try {
      converted = convertCanvasQuestionToVariant(remote);
    } catch {
      skipped += 1;
      continue;
    }

    try {
      const existingQMap = await prisma.canvasBankQuestionMapping.findUnique({
        where: {
          userId_canvasAssessmentQuestionId_localCourseId: {
            userId,
            canvasAssessmentQuestionId: Number(canvasAssessmentQuestionId),
            localCourseId: parsedLocalCourseId,
          },
        },
      });

      if (existingQMap) {
        const metadata = await prisma.questionMetadata.findUnique({
          where: { id: existingQMap.localQuestionMetadataId },
        });
        if (!metadata || Number(metadata.courseId) !== parsedLocalCourseId) {
          skipped += 1;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.questionMetadata.update({
            where: { id: metadata.id },
            data: {
              description: converted.description || metadata.description,
              type: converted.type || metadata.type,
            },
          });
          const variants = await tx.variants.findMany({
            where: { questionMetadataId: metadata.id },
            orderBy: { createdAt: "asc" },
            take: 1,
          });
          if (variants[0]) {
            await tx.variants.update({
              where: { id: variants[0].id },
              data: {
                questionText: converted.questionText,
                answer: converted.answer,
                choices: converted.choices,
              },
            });
          }
          await tx.canvasBankQuestionMapping.update({
            where: { id: existingQMap.id },
            data: { localBankId: String(localBank.id) },
          });
        });
        membershipIds.push(metadata.id);
        updated += 1;
        continue;
      }

      const question = await createQuestion(ownerId, {
        description: converted.description,
        courseId: parsedLocalCourseId,
        primaryTopicId,
        type: converted.type,
        createdBy: userId,
        skipBankAttach: true,
      });

      await prisma.$transaction(async (tx) => {
        await tx.variants.create({
          data: {
            questionMetadataId: question.id,
            questionText: converted.questionText,
            difficulty: "medium",
            answer: converted.answer,
            choices: converted.choices,
            isDraft: false,
            isAiGenerated: false,
          },
        });
        await tx.canvasBankQuestionMapping.create({
          data: {
            userId,
            localCourseId: parsedLocalCourseId,
            localQuestionMetadataId: question.id,
            canvasAssessmentQuestionId: Number(canvasAssessmentQuestionId),
            localBankId: String(localBank.id),
          },
        });
      });
      membershipIds.push(question.id);
      created += 1;
    } catch (error) {
      skipped += 1;
      logger.warn(
        {
          err: error,
          canvasAssessmentQuestionId,
          localCourseId: parsedLocalCourseId,
          localBankId: localBank.id,
        },
        "Skipped Canvas bank question during import",
      );
    }
  }

  if (membershipIds.length > 0) {
    await addQuestionsToBank(parsedLocalCourseId, userId, localBank.id, membershipIds);
  }

  const synced = await prisma.canvasBankMapping.update({
    where: { id: bankMapping.id },
    data: { lastSyncedAt: new Date() },
  });

  return {
    bankId: localBank.id,
    created,
    updated,
    skipped,
    truncated,
    lastSyncedAt: synced.lastSyncedAt,
  };
};

export {
  convertVariantToCanvasQuestion,
  parseMCQOptions,
  convertCanvasQuestionToVariant,
  parseChoicesFromQuestionText,
  stripHtmlTags,
  normalizeCanvasQuestionType,
};
