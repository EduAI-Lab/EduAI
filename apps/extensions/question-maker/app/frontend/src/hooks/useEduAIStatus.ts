/**
 * Shared AI service status hook backed by a module-level store so all consumers stay in sync.
 * Calls the backend test endpoint once and lets any component trigger a refresh for everyone.
 */
import { useSyncExternalStore } from 'react';
import eduaiService from '../services/eduaiService';
import { apiKeyStorage, isCloudProvider } from '../services/apiKeyStorage';

type Status = 'loading' | 'ok' | 'error';

/** When set, the AI service badge shows this phase for question generation (overrides status label). */
export type QuestionGenerationPhase = 'generating' | 'review' | null;

type EduAIState = {
    status: Status;
    message?: string;
    /** Which provider path is live when status==='ok': cloud provider id or campus (`vllm` / legacy `ollama`). */
    provider?: 'google' | 'openai' | 'deepseek' | 'anthropic' | 'vllm' | 'ollama';
    questionGenerationPhase: QuestionGenerationPhase;
};

let state: EduAIState = { status: 'loading', message: 'Checking AI service status', questionGenerationPhase: null };

/** True when the user has saved at least one cloud provider key in this browser. */
const hasCloudKey = async (): Promise<boolean> => {
    try {
        const keys = await apiKeyStorage.getAllApiKeys();
        return Object.keys(keys).length > 0;
    } catch {
        return false;
    }
};
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let retryTimeout: number | null = null;
let retryAttempt = 0; // 0 → 1s, 1 → 2s, 2 → 4s, 3 → 8s, ... capped below

// Bounded backoff for the error path only: this is the sole automatic-recovery
// path for a transient AI-services outage (e.g. UBC wifi/VPN drops briefly).
// Caps at 8s between attempts and gives up after MAX_RETRIES so a persistent
// outage doesn't poll forever in the background — the user can still hit
// "refresh" manually (a status chip click, or saving/clearing an API key).
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRIES = 6; // ~ 1+2+4+8+8+8 = 31s of automatic retrying before giving up

// Clears any pending retry timer. `resetAttempts` is false for the internal call
// made right before a retry itself fires (so the attempt counter it just
// incremented survives), and true for every other caller — success, the
// non-retryable "needs sign-in" error, and any manual/explicit refresh — so a
// fresh error afterwards starts backing off from 1s again.
const clearRetry = (resetAttempts = true) => {
    if (typeof window !== 'undefined' && retryTimeout !== null) {
        window.clearTimeout(retryTimeout);
    }
    retryTimeout = null;
    if (resetAttempts) retryAttempt = 0;
};

const scheduleRetryIfNeeded = () => {
    if (typeof window === 'undefined') return;
    if (retryTimeout !== null) return;
    if (retryAttempt >= MAX_RETRIES) return;

    const delayMs = Math.min(MAX_RETRY_DELAY_MS, 1000 * Math.pow(2, retryAttempt));

    retryTimeout = window.setTimeout(() => {
        retryTimeout = null;
        retryAttempt += 1;
        // Silent re-check: keep the current status visible so the badge/banner
        // don't flicker to "Checking…" on every background retry.
        void refreshEduAIStatus({ silent: true, preserveAttempts: true });
    }, delayMs);
};

const notify = () => listeners.forEach((l) => l());

const setState = (next: Partial<EduAIState>) => {
    state = { ...state, ...next };
    notify();
};

const fetchStatus = async () => {
    try {
        const result = (await Promise.race([
            eduaiService.testApiKey(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('AI service status check timed out')), 10000)
            ),
        ])) as any;

        if (result?.success) {
            const provider = result.provider;
            setState({
                status: 'ok',
                provider,
                message: isCloudProvider(provider)
                    ? 'AI online via your cloud provider key.'
                    : 'AI online via the UBC-hosted model.',
            });
            clearRetry();
        } else if (result?.configured === false) {
            setState({
                status: 'error',
                provider: undefined,
                message: 'AI needs a Core sign-in (shared session cookie). Sign in via Core and retry.'
            });
            clearRetry();
        } else {
            // Service unreachable. Tailor the guidance: if the user has a cloud key
            // saved it failed (bad key / network); if not, point them to Settings —
            // the UBC-hosted model is the only path and it requires UBC network/VPN.
            const cloudKey = await hasCloudKey();
            const provider = result?.provider;
            const message = cloudKey
                ? result?.error ||
                  'Your cloud provider key could not be validated. Check the key in Settings or your network.'
                : 'UBC-hosted AI is unavailable (needs UBC wifi/VPN). Add a cloud provider API key in Settings to use AI off-network.';
            setState({ status: 'error', provider, message });
            scheduleRetryIfNeeded();
        }
    } catch {
        const cloudKey = await hasCloudKey();
        setState({
            status: 'error',
            provider: undefined,
            message: cloudKey
                ? 'Could not reach the AI service. Check your network and try again.'
                : 'AI service unavailable. Connect to UBC wifi/VPN, or add a cloud provider API key in Settings.',
        });
        scheduleRetryIfNeeded();
    }
};

export const setQuestionGenerationPhase = (phase: QuestionGenerationPhase) => {
    if (state.questionGenerationPhase === phase) return;
    state = { ...state, questionGenerationPhase: phase };
    notify();
};

export const refreshEduAIStatus = async (opts?: { silent?: boolean; preserveAttempts?: boolean }) => {
    if (inflight) return inflight;
    // A manual/explicit refresh (status chip click, saving/clearing an API key)
    // supersedes any pending background retry and resets the backoff; the retry
    // loop's own internal call passes preserveAttempts so its counter survives.
    clearRetry(!opts?.preserveAttempts);
    // Background retries pass { silent } to avoid flipping the UI back to "loading".
    if (!opts?.silent) {
        setState({ status: 'loading', message: 'Checking AI service status. Connect to UBC wifi or VPN.' });
    }
    inflight = fetchStatus().finally(() => {
        inflight = null;
    });
    return inflight;
};

void refreshEduAIStatus();

export const useEduAIStatus = () => {
    const subscribe = (callback: () => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
    };

    const getSnapshot = () => state;

    const { status, message, provider, questionGenerationPhase } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    return {
        status,
        message,
        provider,
        questionGenerationPhase,
        setQuestionGenerationPhase,
        refresh: refreshEduAIStatus,
    };
};

export default useEduAIStatus;
