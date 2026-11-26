/**
 * Share the first input and promise among overlapping requests. Call
 * `request(input, true)` to pin that attempt. Withdrawing an unpinned attempt
 * aborts its signal. A subsequent request waits for the old work to settle.
 * @param work - Receives the first caller’s input and an AbortSignal. The caller owns a successful result.
 */
export function createWithdrawableTask(work) {
  let current = null;
  let tail = Promise.resolve();
  function request(input, pinned = false) {
    if (current) {
      if (pinned) current.pinned = true;
      return current.done;
    }
    const controller = new AbortController();
    const attempt = { controller, pinned, done: null };
    current = attempt;
    attempt.done = tail.then(() => {
      controller.signal.throwIfAborted();
      return work(input, controller.signal);
    }).finally(() => {
      if (current === attempt) current = null;
    });
    tail = attempt.done.then(() => {}, () => {});
    return attempt.done;
  }
  function withdraw() {
    if (!current || current.pinned) return false;
    const { controller } = current;
    current = null;
    controller.abort();
    return true;
  }
  return { request, withdraw, get pending() { return !!current; } };
}
