import type { GenerationHistoryItem } from "../../domain/generation";

const HISTORY_KEY = "nano-banana.history.v3";
const DB_NAME = "nano-banana-playground";
const STORE_NAME = "history";
const MAX_ITEMS = 20;

const fallbackLoad = (): GenerationHistoryItem[] => {
  const serialized = window.localStorage.getItem(HISTORY_KEY);
  if (!serialized) return [];
  try { return JSON.parse(serialized) as GenerationHistoryItem[]; } catch { return []; }
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
  const request = window.indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Unable to open history database"));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error("History transaction failed"));
  transaction.onabort = () => reject(transaction.error || new Error("History transaction aborted"));
});

export const loadHistory = async (): Promise<GenerationHistoryItem[]> => {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const items = await new Promise<GenerationHistoryItem[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as GenerationHistoryItem[]);
      request.onerror = () => reject(request.error || new Error("Unable to load history"));
    });
    database.close();
    return items.sort((a, b) => b.result.createdAt.localeCompare(a.result.createdAt)).slice(0, MAX_ITEMS);
  } catch {
    return fallbackLoad();
  }
};

export const saveHistory = async (items: GenerationHistoryItem[]): Promise<void> => {
  const limited = items.slice(0, MAX_ITEMS);
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    limited.forEach((item) => store.put(item));
    await transactionDone(transaction);
    database.close();
  } catch {
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(limited)); } catch { /* best effort */ }
  }
};

export const clearHistory = async () => {
  await saveHistory([]);
};
