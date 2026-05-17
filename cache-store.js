const DB_NAME = "onyomi";
const STORE = "tts-cache";
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function store(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function hash(text, voice, provider) {
  const data = new TextEncoder().encode(`${provider}\n${text}\n${voice}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function get(key) {
  const s = await store("readonly");
  return reqToPromise(s.get(key));
}

export async function put(entry) {
  const s = await store("readwrite");
  return reqToPromise(s.put(entry));
}

export async function del(key) {
  const s = await store("readwrite");
  return reqToPromise(s.delete(key));
}

export async function clear() {
  const s = await store("readwrite");
  return reqToPromise(s.clear());
}

export async function list() {
  const s = await store("readonly");
  const out = [];
  return new Promise((res, rej) => {
    const cursor = s.index("createdAt").openCursor(null, "prev");
    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return res(out);
      const { key, text, voice, provider, size, createdAt } = c.value;
      out.push({ key, text, voice, provider, size, createdAt });
      c.continue();
    };
    cursor.onerror = () => rej(cursor.error);
  });
}
