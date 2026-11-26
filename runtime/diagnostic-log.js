/** Bounded diagnostic entries, scoped to a page, visit and storage key. */
export function createDiagnosticLog({
  storageKey, page = globalThis, capacity = 300, saveDelayMs = 1500,
  idleMs = 5000, textLimit = 600, perSecond = 20, visit = Date.now().toString(36),
}) {
  let placeOf = () => '';
  function stored() {
    try {
      const list = JSON.parse(page.localStorage.getItem(storageKey));
      return Array.isArray(list) ? list : [];
    } catch {
      return []; // storage refused (a private window) or spoilt: start afresh
    }
  }
  const entries = stored();
  let saving = 0,
    burstAt = 0,
    burst = 0,
    dropped = 0;
  const whenIdle = page.requestIdleCallback ? callback => page.requestIdleCallback(callback, { timeout: idleMs }) : callback => page.setTimeout(callback, 0);
  const saveSoon = () => whenIdle(save);
  function save() {
    saving = 0;
    try {
      page.localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // storage full or refused: the log lives on in this visit
    }
  }

  function noteLog(kind, text) {
    const second = Math.floor(page.performance.now() / 1000);
    if (second !== burstAt) {
      burstAt = second;
      burst = 0;
    }
    if (++burst > perSecond) {
      dropped++;
      return;
    }
    if (dropped) {
      const left = dropped;
      dropped = 0;
      noteLog('warn', `${left} entries of the page's log left out: more than ${perSecond} came in one second`);
    }
    const words = String(text).slice(0, textLimit),
      last = entries[entries.length - 1];
    if (last && last.visit === visit && last.kind === kind && last.text === words) last.n = (last.n || 1) + 1;
    else {
      const entry = { t: new Date().toISOString(), kind, text: words, at: page.location.pathname + page.location.search, visit };
      if (kind !== 'note') entry.ctx = where();
      entries.push(entry);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    }
    if (!saving) saving = page.setTimeout(saveSoon, saveDelayMs);
  }

  function where() {
    try {
      return placeOf();
    } catch {
      return ''; // asked while the modules that know are still loading
    }
  }
  function setLogPlace(say) {
    placeOf = say;
  }

  const flushes = [];
  const beforeLogRead = flush => flushes.push(flush);
  function readLog(kind) {
    for (let i = 0; i < flushes.length; i++) flushes[i]();
    return kind ? entries.filter(entry => entry.kind === kind) : entries.slice();
  }
  function clearLog() {
    entries.length = 0;
    save();
  }
  return { beforeLogRead, clearLog, noteLog, readLog, save, setLogPlace };
}
