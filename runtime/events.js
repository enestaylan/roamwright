// Independent synchronous event channels. Listeners run in registration order.
export function createEvents() {
  const listeners = new Map();
  function on(name, listener) {
    const list = listeners.get(name);
    if (list) list.push(listener);
    else listeners.set(name, [listener]);
  }
  function emit(name, ...args) {
    const list = listeners.get(name);
    if (list) for (const listener of list) listener(...args);
  }
  return { on, emit };
}
