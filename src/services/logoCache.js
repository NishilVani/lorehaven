// src/services/logoCache.js

const DB_NAME = "moctale_logo_cache_db";
const STORE_NAME = "logos";
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error("Failed to open IndexedDB logo cache:", event.target.error);
      reject(event.target.error);
    };
  });

  return dbPromise;
}

export const logoCache = {
  async get(id) {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (e) {
      console.warn("logoCache.get failed:", e);
      return null;
    }
  },

  async set(id, data) {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ id, ...data });

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (e) {
      console.warn("logoCache.set failed:", e);
      return false;
    }
  },

  async clear() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (e) {
      console.warn("logoCache.clear failed:", e);
      return false;
    }
  }
};
