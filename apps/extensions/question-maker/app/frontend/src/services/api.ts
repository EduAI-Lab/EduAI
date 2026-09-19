import axios, { AxiosResponse, AxiosError } from "axios";
import { getCoreLoginUrl } from "@/lib/coreUrl";
import { isString } from "@eduai/ui/primitive-union";
import { apiKeyStorage } from "./apiKeyStorage";

export const API_URL = (import.meta as any).env?.VITE_API_URL || "";

/**
 * Server pagination envelope (#1044). QM's paginated list endpoints return
 * `{ success, data, total, page, pageSize }`; `data` stays a bare array so
 * existing readers that only touch `data` keep working. Mirrors ai-tutor's
 * `Paginated<T>` (#1043) / Core's contract (#1041), plus QM's `success` flag.
 */
export type Paginated<T> = {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Query-string values, as axios serialises them. Named so a list call can
 * assemble its params key by key and still say what may go in one — anything
 * that is not a scalar has to be joined into one first.
 */
export type QueryParams = Record<string, string | number | boolean | undefined>;

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

/**
 * The subset of an AI request body this interceptor cares about — every call
 * site that carries a provider key (`generateQuestions`, `extractQuestionsFromText`,
 * `chat`) sends both fields together.
 */
type ProviderAuthRequestBody = {
  model?: string;
  apiKeys?: Record<string, { apiKey?: string; isEnabled?: boolean }>;
};

/**
 * Best-effort parse of an axios request body back into an object: by the time
 * a request fails, axios's default `transformRequest` has usually already
 * serialized a plain-object body to a JSON string on `config.data` — but a
 * caller-supplied `transformRequest`, or a test harness, may leave it as the
 * original object. Returns `null` for anything that isn't (or doesn't parse
 * into) a plain object, rather than throwing.
 *
 * SAFETY: the `as` casts below only ever run on a value already narrowed to
 * `instanceof Object` (a parsed JSON object or the original request body);
 * the fields this interceptor reads (`model`, `apiKeys`) are re-checked with
 * `isString` / `instanceof Object` at the call site before use.
 */
function parseRequestBody(data: any): ProviderAuthRequestBody | null {
  if (data instanceof Object) return data as ProviderAuthRequestBody;
  if (!isString(data)) return null;
  try {
    const parsed = JSON.parse(data);
    return parsed instanceof Object ? (parsed as ProviderAuthRequestBody) : null;
  } catch {
    return null;
  }
}

/**
 * Centralizes save-time-verdict invalidation (task 15) for every AI call
 * that fails with a provider-auth status. Originally this lived only in
 * `eduaiService.generateQuestions`'s own catch block — but that missed OCR
 * extraction (`questionService.extractQuestionsFromText`, used by
 * `QuestionUploadDialog` and `CourseDetailPage`'s background-extraction
 * flow), which posts the same `model` + `apiKeys` shape to a different
 * endpoint and left a revoked key green in the cloud chip forever. Living
 * here instead means any current or future POST that carries that shape is
 * covered without its call site having to remember to invalidate anything.
 */
function invalidateProviderKeyOnAuthFailure(error: AxiosError): void {
  const status = error.response?.status;
  if (status !== 401 && status !== 403) return;

  const body = parseRequestBody(error.config?.data);
  const model = body?.model;
  const apiKeys = body?.apiKeys;
  if (!isString(model) || !(apiKeys instanceof Object)) return;

  const provider = apiKeyStorage.getProviderFromModel(model);
  if (!provider) return;

  apiKeyStorage.setValidation(provider, {
    valid: false,
    validatedAt: new Date().toISOString(),
    error: "Key was rejected during generation.",
  });
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const apiError = (error.response.data as { error?: string; success?: boolean })?.error;
      const isSessionExpired =
        apiError === "Authentication required" ||
        (apiError === "Unauthorized" &&
          isString(error.config?.url) &&
          error.config.url.includes("/api/auth/me"));

      if (isSessionExpired) {
        window.location.href = getCoreLoginUrl();
      }
    }

    invalidateProviderKeyOnAuthFailure(error);

    return Promise.reject(error);
  },
);

export default api;
