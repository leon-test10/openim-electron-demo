export type LocalFolderShareCacheEntry = {
  shareID: string;
  folderName: string;
  nativePath: string;
  cachedAt: number;
};

const storageKey = "openim-agent.local-folder-share-cache.v1";
const memoryCache = new Map<string, LocalFolderShareCacheEntry>();

const readStoredCache = () => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const entries = JSON.parse(raw) as LocalFolderShareCacheEntry[];
    entries.forEach((entry) => {
      if (entry.shareID && entry.nativePath) {
        memoryCache.set(entry.shareID, entry);
      }
    });
  } catch {
    window.localStorage.removeItem(storageKey);
  }
};

const persistCache = () => {
  if (typeof window === "undefined") return;
  const entries = Array.from(memoryCache.values())
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(0, 300);
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
};

export const recordLocalFolderShare = (
  shareID: string,
  folderName: string,
  nativePath: string,
) => {
  if (!shareID || !nativePath) return;
  if (memoryCache.size === 0) readStoredCache();
  memoryCache.set(shareID, {
    shareID,
    folderName,
    nativePath,
    cachedAt: Date.now(),
  });
  persistCache();
};

export const getLocalFolderShare = (
  shareID: string,
): LocalFolderShareCacheEntry | undefined => {
  if (memoryCache.size === 0) readStoredCache();
  return memoryCache.get(shareID);
};
