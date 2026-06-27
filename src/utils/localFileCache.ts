export type LocalFileCacheEntry = {
  clientMsgID: string;
  fileName: string;
  nativePath: string;
  cachedAt: number;
};

const storageKey = "openim-agent.local-file-cache.v1";
const memoryCache = new Map<string, LocalFileCacheEntry>();

const readStoredCache = () => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const entries = JSON.parse(raw) as LocalFileCacheEntry[];
    for (const entry of entries) {
      if (entry.clientMsgID && entry.nativePath) {
        memoryCache.set(entry.clientMsgID, entry);
      }
    }
  } catch {
    window.localStorage.removeItem(storageKey);
  }
};

const persistCache = () => {
  if (typeof window === "undefined") return;
  const entries = Array.from(memoryCache.values())
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(0, 500);
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
};

export const recordLocalFileForMessage = (
  clientMsgID: string,
  fileName: string,
  nativePath: string,
) => {
  if (!clientMsgID || !nativePath) return;
  if (memoryCache.size === 0) readStoredCache();
  memoryCache.set(clientMsgID, {
    clientMsgID,
    fileName,
    nativePath,
    cachedAt: Date.now(),
  });
  persistCache();
};

export const getLocalFileForMessage = (
  clientMsgID: string,
): LocalFileCacheEntry | undefined => {
  if (memoryCache.size === 0) readStoredCache();
  return memoryCache.get(clientMsgID);
};
