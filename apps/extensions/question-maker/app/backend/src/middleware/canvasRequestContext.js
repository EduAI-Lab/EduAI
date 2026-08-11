/**
 * Carries an Express caller-disconnect signal into Canvas service calls
 * without changing the existing service function argument contracts.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const canvasRequestStorage = new AsyncLocalStorage();

export function canvasRequestContext(req, res, next) {
  const controller = new AbortController();
  const abortForDisconnect = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  const cleanup = () => {
    req.off?.('aborted', abortForDisconnect);
    res.off?.('finish', cleanup);
    res.off?.('close', cleanup);
  };

  if (req.aborted) abortForDisconnect();
  else req.once?.('aborted', abortForDisconnect);
  res.once?.('finish', cleanup);
  res.once?.('close', cleanup);

  canvasRequestStorage.run({ signal: controller.signal }, next);
}

export function currentCanvasRequestSignal() {
  return canvasRequestStorage.getStore()?.signal;
}

