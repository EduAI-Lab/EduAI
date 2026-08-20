/**
 * Carries an Express caller-disconnect signal into Canvas service calls
 * without changing the existing service function argument contracts.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const canvasRequestStorage = new AsyncLocalStorage();

export function canvasRequestContext(req, res, next) {
  const controller = new AbortController();
  let finished = false;
  let cleaned = false;
  const abortForDisconnect = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Client disconnected", "AbortError"));
    }
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    req.off?.("aborted", abortForDisconnect);
    req.off?.("close", onRequestClose);
    res.off?.("finish", onFinish);
    res.off?.("close", onResponseClose);
  };
  const onFinish = () => {
    finished = true;
    cleanup();
  };
  const onRequestClose = () => {
    // IncomingMessage.close also fires for a normally completed request body
    // before the response finishes. Only an incomplete body is a disconnect;
    // post-body socket closure is handled by the response close listener.
    if (finished || res.writableEnded) {
      cleanup();
      return;
    }
    if (!req.complete) {
      abortForDisconnect();
      cleanup();
    }
  };
  const onResponseClose = () => {
    // `close` follows `finish` for a normal response. A close before the
    // response is writable-ended is a caller/socket disconnect and must abort
    // an in-flight upstream request.
    if (!finished && !res.writableEnded) abortForDisconnect();
    cleanup();
  };

  if (req.aborted) abortForDisconnect();
  else req.once?.("aborted", abortForDisconnect);
  req.once?.("close", onRequestClose);
  res.once?.("finish", onFinish);
  res.once?.("close", onResponseClose);

  canvasRequestStorage.run({ signal: controller.signal }, next);
}

export function currentCanvasRequestSignal() {
  return canvasRequestStorage.getStore()?.signal;
}
