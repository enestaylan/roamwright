/** Preload dependency URLs once per loader, relative to the caller's module. */
export function createModulePreloader(base, document = globalThis.document) {
  const requested = new Set();
  return files => {
    for (const file of files) {
      const url = new URL(file, base).href;
      if (requested.has(url)) continue;
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = url;
      document.head.appendChild(link);
      requested.add(url);
    }
  };
}
