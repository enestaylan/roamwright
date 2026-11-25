// Persist typed grid arrays in IndexedDB. A synchronous hint lets a consumer
// start computing immediately on a cold visit. A missing hint is always safe.
export function createGridCache({ database, store, build, hintPrefix }) {
  const prefix = build + ' ';

  function open() {
    return new Promise(resolve => {
      try {
        const request = indexedDB.open(database, 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore(store);
        request.onblocked = () => { blocked = true; resolve(null); };
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          if (blocked) request.result.close();
          else resolve(request.result);
        };
      } catch {
        resolve(null);
      }
    });
  }

  function hasKept(name) {
    try {
      return !!build && localStorage.getItem(hintPrefix + name) === build;
    } catch {
      return false;
    }
  }

  async function takeKept(name, arrays) {
    if (!build) return false;
    const db = await open();
    if (!db) return false;
    try {
      const kept = await new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(prefix + name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!Array.isArray(kept) || kept.length !== arrays.length ||
          !kept.every((a,i) => ArrayBuffer.isView(a) && a.constructor === arrays[i].constructor && a.length === arrays[i].length)) return false;
      arrays.forEach((array,i) => array.set(kept[i]));
      return true;
    } catch {
      return false;
    } finally {
      db.close();
    }
  }

  async function keep(name, arrays) {
    if (!build) return;
    const db = await open();
    if (!db) return;
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        const records = transaction.objectStore(store);
        const keys = records.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) if (!String(key).startsWith(prefix)) records.delete(key);
        };
        records.put(arrays, prefix + name);
      });
      localStorage.setItem(hintPrefix + name, build);
    } catch {
      // A refused or full store can be retried on the next visit.
    } finally {
      db.close();
    }
  }

  return { hasKept, takeKept, keep };
}
