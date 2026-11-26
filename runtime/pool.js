/** The pool can use every logical processor the browser exposes beyond its main thread. */
export function workerCapacity(cores = globalThis.navigator?.hardwareConcurrency) {
  return Number.isFinite(cores) ? Math.max(1, Math.floor(cores) - 1) : 1;
}

/**
 * Route weighted jobs to FIFO workers. Each worker receives { job, input } and
 * replies in order with { result } or { error }. Supply prestarted workers to
 * adopt them immediately. Supply startWorkers for a fixed pool, or createWorker
 * for a pool that grows with concurrent work up to maxWorkers. A broadcast
 * initializes every worker, so later jobs see the state it set.
 */
export function createPool({
  startWorkers, createWorker, initialWorkers, maxWorkers = workerCapacity(),
  idleMs = 4000, warn = message => console.warn(message),
} = {}) {
  const slots = [];
  const preparations = new Map();
  const elastic = typeof createWorker === 'function';
  let capacity = Number.isFinite(maxWorkers) ? Math.max(1, Math.floor(maxWorkers)) : 1;
  let broken = !elastic && typeof startWorkers !== 'function',
    idle = 0,
    held = 0;

  const pooled = () => !broken;
  const poolSize = () => slots.length;

  function rest() {
    for (const { worker } of slots) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    slots.length = 0;
  }
  function giveUp(reason) {
    if (broken) return;
    warn(`pool: ${reason}; the work is done on the page from now on`);
    broken = true;
    const waiting = slots.flatMap(slot => slot.tasks);
    clearTimeout(idle);
    rest();
    for (const task of waiting) task.refuse(new Error('pool: ' + reason));
  }
  function attach(worker) {
    const slot = { worker, tasks: [], holds: new Set() };
    worker.onmessage = ({ data }) => finish(slot, data);
    worker.onerror = event => giveUp(event.message || 'a worker could not start');
    worker.onmessageerror = () => giveUp('an answer could not be read');
    slots.push(slot);
  }
  function grow() {
    if (!elastic || broken || slots.length >= capacity) return;
    try {
      attach(createWorker());
    } catch (error) {
      if (!slots.length) giveUp(error.message);
      else capacity = slots.length; // A browser resource limit can be lower than its hardware count.
    }
  }
  function adopt(workers) {
    for (const worker of workers) attach(worker);
    if (!workers.length || workers.some(worker => worker.failed)) giveUp('the workers could not start');
    else restWhenIdle();
  }
  function restWhenIdle() {
    clearTimeout(idle);
    if (slots.length && !held && slots.every(slot => !slot.tasks.length)) idle = setTimeout(rest, idleMs);
  }
  function keepAwake(until) {
    held++;
    clearTimeout(idle);
    const release = () => {
      held--;
      restWhenIdle();
    };
    until.then(release, release);
  }
  function refusal(job, reason) {
    warn(`pool: ${job} refused (${reason}); worked out on the page instead`);
    return new Error(`pool: ${job}: ${reason}`);
  }
  // Jobs queued after a failed preparation must reject, up to the next attempt to prepare this worker.
  function spoil(slot, name) {
    for (const later of slot.tasks) {
      if (later.prepares === name) return;
      if (later.needs === name) later.spoiled = name;
    }
    slot.holds.delete(name);
  }
  function finish(slot, answer) {
    const task = slot.tasks.shift();
    if (answer.error && task.prepares) spoil(slot, task.prepares);
    if (answer.error) task.refuse(refusal(task.job, answer.error));
    else if (task.spoiled) task.refuse(refusal(task.job, `its preparation, ${task.spoiled}, failed`));
    else task.keep(answer.result);
    restWhenIdle();
  }
  function send(slot, job, input, transfer, cost = 1, needs = null, prepares = null) {
    return new Promise((keep, refuse) => {
      try {
        slot.worker.postMessage({ job, input }, transfer);
      } catch (error) {
        if (prepares) slot.holds.delete(prepares);
        refuse(refusal(job, error.message));
        return;
      }
      slot.tasks.push({ job, keep, refuse, cost, needs, prepares, spoiled: null });
      clearTimeout(idle);
    });
  }
  function awake() {
    if (!broken && !slots.length) {
      try {
        if (elastic) grow();
        else adopt(startWorkers());
      } catch (error) {
        giveUp(error.message);
      }
    }
    return slots;
  }
  const UNNAMED = { input: undefined, cost: 1 };
  const noWorkers = () => Promise.reject(new Error('pool: no workers'));
  const unheard = () => {};
  const load = slot => slot.tasks.reduce((sum, task) => sum + task.cost, 0);
  // Costs include both running and queued jobs. Dispatch immediately, even when the main thread is busy.
  const leastBusy = list => list.reduce((a, b) => (load(b) < load(a) ? b : a));
  // Register the input to send once per worker before a job that names this preparation.
  function prepare(name, input, cost = 1) {
    preparations.set(name, { input, cost });
    for (const slot of slots) slot.holds.delete(name);
  }
  function run(job, input, transfer = [], needs = null, cost = 1) {
    if (!awake().length) return noWorkers();
    if (elastic && slots.every(slot => slot.tasks.length)) grow();
    let least = leastBusy(slots);
    if (needs && !least.holds.has(needs)) {
      const holding = slots.filter(slot => slot.holds.has(needs)),
        preparation = preparations.get(needs) ?? UNNAMED;
      if (holding.length && load(leastBusy(holding)) <= load(least) + preparation.cost) least = leastBusy(holding);
      else {
        least.holds.add(needs);
        send(least, needs, preparation.input, [], preparation.cost, null, needs).catch(unheard);
        if (!least.holds.has(needs)) return Promise.reject(new Error(`pool: ${job}: ${needs} could not be sent`));
      }
    }
    return send(least, job, input, transfer, cost, needs);
  }
  function runOrHere(job, inputOf, here, cost = 1, needs = null) {
    if (broken) return Promise.resolve().then(here);
    return run(job, inputOf(), [], needs, cost).catch(here);
  }
  function spread(name, count) {
    const preparation = preparations.get(name);
    if (!preparation) return;
    if (!awake().length) return;
    while (elastic && slots.length < Math.min(count, capacity)) grow();
    const others = slots.filter(slot => !slot.holds.has(name)),
      more = Math.min(count, slots.length) - (slots.length - others.length);
    for (const slot of others.sort((a, b) => load(a) - load(b)).slice(0, Math.max(0, more))) {
      slot.holds.add(name);
      send(slot, name, preparation.input, [], preparation.cost, null, name).catch(unheard);
    }
  }
  // The worker protocol reserves the load job for fetching a named job's implementation.
  function ready(job) {
    for (const slot of awake())
      if (!slot.holds.has(job)) {
        send(slot, 'load', job, []).catch(unheard);
        slot.holds.add(job);
      }
  }
  function runOnEach(job, input, { activeOnly = false } = {}) {
    if (!activeOnly) {
      if (!awake().length) return noWorkers();
      while (elastic && slots.length < capacity) grow();
    }
    return Promise.all(slots.map(slot => send(slot, job, input, [])));
  }
  if (!broken && initialWorkers) adopt(initialWorkers);
  return { keepAwake, pooled, poolSize, prepare, ready, run, runOnEach, runOrHere, spread };
}
