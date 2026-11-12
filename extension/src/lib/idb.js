/**
 * OutFox — IndexedDB High-Scale Fast Store
 * Manages 'outfox_db_v1' with 'profiles' and 'actions' object stores.
 */

const DB_NAME = 'outfox_db_v1';
const DB_VERSION = 1;

let dbPromise = null;

export function isIdbAvailable() {
  return typeof indexedDB !== 'undefined';
}

export function openDb() {
  if (!isIdbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'publicId' });
        }
        if (!db.objectStoreNames.contains('actions')) {
          const actionStore = db.createObjectStore('actions', { keyPath: 'id' });
          actionStore.createIndex('at', 'at', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[IDB] open failed:', request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('[IDB] open exception:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

export async function idbGet(storeName, key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbGetAll(storeName) {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbPut(storeName, value) {
  const db = await openDb();
  if (!db || !value) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbPutMany(storeName, values) {
  const db = await openDb();
  if (!db || !Array.isArray(values) || !values.length) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const val of values) {
        if (val) store.put(val);
      }
      tx.oncomplete = () => resolve(values);
      tx.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbCount(storeName) {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

