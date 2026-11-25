export const LEVELS = ['low', 'medium', 'high'];

export function createQualityStore(namespace) {
  const ONCE = `${namespace}:quality-once`, // in the tab's own storage: the preset its next page opens with, whatever is kept
    CHOSEN = `${namespace}:quality`,
    FITTED = `${namespace}:quality-fit`,
    SCALE = `${namespace}:quality-scale`;

  function read(key) {
    try {
      const kept = localStorage.getItem(key);
      return LEVELS.includes(kept) ? kept : null;
    } catch {
      return null; // no storage (a private window)
    }
  }
  function write(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      // no storage: it holds for this page
    }
  }
  // The share of each side the preset `name` was last drawn at, if it was found for that preset.
  function keptScale(name) {
    try {
      const kept = JSON.parse(localStorage.getItem(SCALE));
      return kept?.name === name && kept.scale > 0 && kept.scale <= 1 ? kept.scale : 1;
    } catch {
      return 1;
    }
  }
  const keepScale = (name, scale) => write(SCALE, JSON.stringify({ name, scale }));
  // The preset this tab's next page opens with for once, and that preset on the page it was left for (read twice there: by the
  // renderer for its canvas, then by the fit, which lets go of it with `taken`).
  function keepOnce(name) {
    try {
      sessionStorage.setItem(ONCE, name);
    } catch {
      // no storage: the next page opens as kept
    }
  }
  function keptOnce(taken = false) {
    try {
      const kept = sessionStorage.getItem(ONCE);
      if (taken) sessionStorage.removeItem(ONCE);
      return LEVELS.includes(kept) ? kept : null;
    } catch {
      return null;
    }
  }
  const keptChoice = () => read(CHOSEN),
    keptFit = () => read(FITTED),
    keepChoice = name => write(CHOSEN, name),
    keepFit = name => write(FITTED, name);
  return { keepChoice, keepFit, keepOnce, keepScale, keptChoice, keptFit, keptOnce, keptScale };
}
