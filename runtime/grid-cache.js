// Persist typed grid arrays in IndexedDB. A synchronous hint lets a consumer
// start computing immediately on a cold visit. A missing hint is always safe.
export function createGridCache({ database, store, build, revisions, hintPrefix }) {
  const revisionOf = name => revisions ? Object.hasOwn(revisions, name) && revisions[name] : build;
  const recordKey = (name, revision) => revisions ? [name, revision] : revision + ' ' + name;

  function obsolete(key, name, revision) {
    if (!revisions) return !String(key).startsWith(build + ' ');
    // Drop legacy build-wide records. With individual revisions, retire only this grid's older copies.
    return !Array.isArray(key) || (key[0] === name && key[1] !== revision);
  }

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
      const revision = revisionOf(name);
      return !!revision && localStorage.getItem(hintPrefix + name) === revision;
    } catch {
      return false;
    }
  }

  async function takeKept(name, arrays) {
    const revision = revisionOf(name);
    if (!revision) return false;
    const db = await open();
    if (!db) return false;
    try {
      const kept = await new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(recordKey(name, revision));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!Array.isArray(kept) || kept.length !== arrays.length ||
          !kept.every((cachedArray,i) => ArrayBuffer.isView(cachedArray) && cachedArray.constructor === arrays[i].constructor && cachedArray.length === arrays[i].length)) return false;
      arrays.forEach((array,i) => array.set(kept[i]));
      return true;
    } catch {
      return false;
    } finally {
      db.close();
    }
  }

  async function keep(name, arrays) {
    const revision = revisionOf(name);
    if (!revision) return;
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
          for (const key of keys.result) if (obsolete(key, name, revision)) records.delete(key);
        };
        records.put(arrays, recordKey(name, revision));
      });
      localStorage.setItem(hintPrefix + name, revision);
    } catch {
      // A refused or full store can be retried on the next visit.
    } finally {
      db.close();
    }
  }

  return { hasKept, takeKept, keep };
}
