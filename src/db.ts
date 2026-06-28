// src/db.ts
//
// this module is the whole storage layer, read it top to bottom like a tour
// everything that touches indexeddb lives here, the react components never see
// a raw IDBRequest, they only call the typed functions exported at the bottom
//
// the mental model, in order:
//   open  -> connection to a named, versioned database
//   onupgradeneeded -> the ONLY place you may create or change stores and indexes
//   transaction -> a scoped, atomic window you do reads or writes in
//   request -> a single async operation inside a transaction, fires onsuccess or onerror
//   cursor -> a moving pointer that walks records one at a time
//
// the indexeddb api is callback and event based and lowkey held together by event
// listeners and vibes, so the first thing we build is a promise wrapper to make it
// bearable in modern async code

// ---------------------------------------------------------------------------
// types: these are part of the lesson, so they are commented too
// ---------------------------------------------------------------------------

// Expense is the exact shape of one record sitting inside the object store
// id is the auto incremented primary key, it is assigned BY indexeddb on write,
// not by us, so it only exists on records that were already saved
export interface Expense {
  id: number; // primary key, auto incremented by the store, present after save
  name: string; // free text label like "train ticket"
  amount: number; // stored as a real number, not a formatted string
  category: string; // one of the small fixed set below
  date: string; // iso date string yyyy-mm-dd, sorts lexicographically so indexes range nicely
  receipt?: Blob; // optional binary blob, proof that indexeddb holds files not just text
}

// NewExpense is Expense minus the id, because before a write there is no key yet
// we keep these as two separate types so a reader can see the exact difference
// between "a thing i want to save" and "a thing that has been saved"
export type NewExpense = Omit<Expense, "id">;

// the fixed category set, kept tiny on purpose so the dropdown and the cursor demo
// stay legible, exported so the form and filters share one source of truth
export const CATEGORIES = ["food", "travel", "supplies", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// the promise wrapper: the only abstraction over the raw api we allow ourselves
// ---------------------------------------------------------------------------

// promisify takes any IDBRequest<T> and hands back a Promise<T>
// the generic T flows straight through from the request, so:
//   promisify(store.get(1))      -> Promise<Expense | undefined>
//   promisify(store.getAll())    -> Promise<Expense[]>
//   promisify(store.count())     -> Promise<number>
// one tiny function, typed once, works for every read and write, that is the
// whole point of the generic, the caller never re writes onsuccess by hand
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // onsuccess fires when the request resolves, request.result holds the value
    request.onsuccess = () => resolve(request.result);
    // onerror fires when the request fails, request.error holds a DOMException
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// the event log: plain english narration so the invisible lifecycle is visible
// ---------------------------------------------------------------------------

// each log line gets a kind so the ui can color it, time is filled in on emit
export type LogKind =
  | "open"
  | "upgrade"
  | "tx"
  | "request"
  | "cursor"
  | "commit"
  | "index"
  | "blob"
  | "info"
  | "error";

export interface LogEntry {
  seq: number; // strictly increasing id so react keys stay stable
  time: string; // wall clock hh:mm:ss for the till tape
  kind: LogKind; // category for styling
  message: string; // the lowercase narration line
}

// a tiny pub sub so any component can subscribe to the narration stream
// db code calls log(), the EventLog component renders whatever comes through
let logSeq = 0;
const logListeners = new Set<(entry: LogEntry) => void>();

export function subscribeToLog(fn: (entry: LogEntry) => void): () => void {
  logListeners.add(fn);
  // return an unsubscribe so react effects can clean up
  return () => logListeners.delete(fn);
}

function log(kind: LogKind, message: string): void {
  const now = new Date();
  // hand format hh:mm:ss, no need to pull in a date library for a learning toy
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const entry: LogEntry = { seq: logSeq++, time, kind, message };
  // fan the entry out to every current subscriber
  logListeners.forEach((fn) => fn(entry));
}

// ---------------------------------------------------------------------------
// database identity and versioning
// ---------------------------------------------------------------------------

// the database name is constant, the version is a number that gates schema changes
// bumping the version is the ONLY way to enter onupgradeneeded and edit the schema
export const DB_NAME = "receipt-vault";
export const STORE = "expenses";

// we let the user choose between schema v1 and v2 to make migrations tangible,
// we remember their choice in localStorage so a refresh keeps the same version,
// localStorage is fine here because it is just a single small number not the data
const VERSION_KEY = "receipt-vault-schema-version";

export function currentVersion(): number {
  const raw = localStorage.getItem(VERSION_KEY);
  // default to 1, the migration demo is opt in
  return raw ? Number(raw) : 1;
}

function setVersion(v: number): void {
  localStorage.setItem(VERSION_KEY, String(v));
}

// index name constants, kept in one place so typos cannot drift between
// createIndex and the later index(...) lookups
const IDX_DATE = "by_date"; // single field index on date, added in v1
const IDX_CATEGORY = "by_category"; // single field index on category, added in v1
const IDX_CATEGORY_DATE = "by_category_date"; // compound index [category, date], added in v2

// ---------------------------------------------------------------------------
// opening the connection
// ---------------------------------------------------------------------------

// we cache one open connection per version, opening repeatedly is wasteful and
// a held connection is what other tabs would have to wait on during an upgrade
let dbPromise: Promise<IDBDatabase> | null = null;

// openDB resolves to a live connection at the given version, creating or migrating
// the schema inside onupgradeneeded if the on disk version is older
function openDB(version: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    log("open", `open("${DB_NAME}", ${version}) requested`);

    // indexedDB.open returns a request immediately, the real work is async
    const request = indexedDB.open(DB_NAME, version);

    // onupgradeneeded fires ONLY when the requested version is higher than the
    // version already on disk, this is the single place schema can change, you
    // cannot add a store or an index anywhere else, ever
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // the upgrade runs inside a special versionchange transaction that the
      // browser created for us, we grab it to reach existing stores during a migration
      const tx = request.transaction;
      const oldVersion = event.oldVersion; // 0 means the db did not exist yet
      const newVersion = event.newVersion ?? version;
      log(
        "upgrade",
        `onupgradeneeded: migrating schema v${oldVersion} -> v${newVersion}`,
      );

      // v1 schema: create the store and its two single field indexes
      // we only create the store if it is missing, so this block is safe to run
      // whether this is a brand new db or an upgrade from an even older version
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath id plus autoIncrement means the store hands out integer keys
        // for us, so NewExpense never carries an id and Expense always does
        store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        log("upgrade", `created object store "${STORE}" keyPath id autoIncrement`);

        // an index lets us query by a field other than the primary key, without
        // scanning every record, here we index date so range queries are cheap
        store.createIndex(IDX_DATE, "date", { unique: false });
        log("index", `created index "${IDX_DATE}" on date`);

        // and category so filtering one category uses the index not a full scan
        store.createIndex(IDX_CATEGORY, "category", { unique: false });
        log("index", `created index "${IDX_CATEGORY}" on category`);
      } else {
        // the store already exists, this is a real migration, reuse the
        // versionchange transaction to reach the existing store object
        // the non null assertion is safe: onupgradeneeded always has a transaction
        store = tx!.objectStore(STORE);
      }

      // v2 schema: add a compound index on [category, date]
      // a compound index lets you query "this category, ordered by date" in one
      // shot, the migration only runs when crossing from below v2 up to v2 or higher
      if (oldVersion < 2 && newVersion >= 2) {
        if (!store.indexNames.contains(IDX_CATEGORY_DATE)) {
          store.createIndex(IDX_CATEGORY_DATE, ["category", "date"], {
            unique: false,
          });
          log(
            "index",
            `v2 migration: created compound index "${IDX_CATEGORY_DATE}" on [category, date]`,
          );
        }
      }
    };

    // onsuccess fires when the connection is open and any upgrade has finished
    request.onsuccess = () => {
      const db = request.result;
      log("open", `connection open, db at version ${db.version}`);

      // versionchange fires on THIS connection when ANOTHER context wants to open
      // the db at a higher version, if we do not close, that other open is blocked,
      // so we close politely to let migrations elsewhere proceed
      db.onversionchange = () => {
        log("info", "another context wants to upgrade, closing this connection");
        db.close();
        dbPromise = null;
      };

      resolve(db);
    };

    // onerror at the open stage usually means a blocked or corrupt db
    request.onerror = () => {
      log("error", `open failed: ${request.error?.message ?? "unknown"}`);
      reject(request.error);
    };

    // onblocked fires when an older connection is still open and holding the db,
    // preventing our version bump, the held connection has to close first
    request.onblocked = () => {
      log("info", "open blocked: an older connection is still open somewhere");
    };
  });
}

// getDB returns the cached connection or opens a fresh one at the current version
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(currentVersion());
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// a small transaction helper so every operation narrates its own scope
// ---------------------------------------------------------------------------

// withStore opens a transaction in the requested mode, logs the scope, hands the
// store to your callback, and resolves when the transaction COMMITS, not merely
// when the request succeeds, because commit is the real durability moment
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await getDB();
  // a transaction is scoped to named stores and a mode, readonly allows many
  // concurrent readers, readwrite is needed before any add put or delete
  const tx = db.transaction(STORE, mode);
  log("tx", `opened transaction (${mode}) on "${STORE}"`);

  // run the caller work, capturing the request result, the request resolves
  // first, then the transaction commits a moment later
  const result = await work(tx.objectStore(STORE));

  // wait for the transaction itself to finish, oncomplete is the commit signal,
  // this is the line that proves the bytes are actually on disk
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      log("commit", `transaction committed (${mode})`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });

  return result;
}

// ---------------------------------------------------------------------------
// crud: every function here is one transaction, narrated, returning typed data
// ---------------------------------------------------------------------------

// add inserts a brand new record, the store assigns the auto incremented key and
// the request result IS that new key, which we log so you can watch keys count up
export async function addExpense(expense: NewExpense): Promise<number> {
  // readwrite because we are inserting, readonly would throw the moment we add
  return withStore("readwrite", async (store) => {
    // store.add rejects if a record with the same key already exists, which is
    // exactly what we want for inserts, put would silently overwrite instead
    const key = await promisify(store.add(expense));
    // the key comes back typed as IDBValidKey, our keys are numbers so we narrow it
    const id = key as number;
    log("request", `add succeeded, store assigned key ${id}`);
    return id;
  });
}

// put updates an existing record by its key, or inserts if the key is absent,
// we pass a full Expense including its id so the store knows which row to replace
export async function updateExpense(expense: Expense): Promise<number> {
  return withStore("readwrite", async (store) => {
    const key = await promisify(store.put(expense));
    const id = key as number;
    log("request", `put succeeded, wrote key ${id}`);
    return id;
  });
}

// get reads a single record by primary key, result is Expense or undefined if the
// key is not present, note the undefined in the return type, get never throws on a miss
export async function getExpense(id: number): Promise<Expense | undefined> {
  return withStore("readonly", async (store) => {
    const record = await promisify(store.get(id));
    log("request", `get(${id}) ${record ? "found a record" : "found nothing"}`);
    return record as Expense | undefined;
  });
}

// getAll pulls every record in the store in primary key order, fine for a small
// learning app, in a real one with many rows you would paginate with a cursor
export async function getAllExpenses(): Promise<Expense[]> {
  return withStore("readonly", async (store) => {
    const all = await promisify(store.getAll());
    log("request", `getAll returned ${all.length} record(s)`);
    return all as Expense[];
  });
}

// delete removes one record by key, the request resolves with undefined either way,
// so we count first if we want to prove the row is gone, kept simple here
export async function deleteExpense(id: number): Promise<void> {
  return withStore("readwrite", async (store) => {
    await promisify(store.delete(id));
    log("request", `delete(${id}) succeeded`);
  });
}

// count asks the store how many records exist without reading any of them, this
// is what keeps the inspector record count cheap to refresh after each op
export async function countExpenses(): Promise<number> {
  return withStore("readonly", async (store) => {
    const n = await promisify(store.count());
    log("request", `count returned ${n}`);
    return n;
  });
}

// ---------------------------------------------------------------------------
// index backed queries: the whole reason indexes exist
// ---------------------------------------------------------------------------

// getByDateRange returns records whose date falls within [start, end] inclusive,
// it walks the date index using a key range, so the engine jumps to the start of
// the range instead of scanning and discarding every unrelated record
export async function getByDateRange(
  start: string,
  end: string,
): Promise<Expense[]> {
  return withStore("readonly", async (store) => {
    // open the date index, queries on it are ordered by date not by primary key
    const index = store.index(IDX_DATE);
    // bound builds an inclusive lower and upper bound, dates are iso strings so
    // lexicographic order matches chronological order, which is why iso was chosen
    const range = IDBKeyRange.bound(start, end);
    log(
      "index",
      `querying index "${IDX_DATE}" with bound(${start}, ${end}), this uses the index not a full scan`,
    );
    const rows = await promisify(index.getAll(range));
    log("request", `index range returned ${rows.length} record(s)`);
    return rows as Expense[];
  });
}

// getByCategory returns every record in one category by querying the category
// index with an exact key, again the index means no full table scan
export async function getByCategory(category: string): Promise<Expense[]> {
  return withStore("readonly", async (store) => {
    const index = store.index(IDX_CATEGORY);
    log(
      "index",
      `querying index "${IDX_CATEGORY}" for category "${category}", index lookup not full scan`,
    );
    // passing a bare key to getAll is shorthand for IDBKeyRange.only(key)
    const rows = await promisify(index.getAll(category));
    log("request", `index lookup returned ${rows.length} record(s)`);
    return rows as Expense[];
  });
}

// ---------------------------------------------------------------------------
// cursor: the weirdest part of the api, so we narrate every single step
// ---------------------------------------------------------------------------

// the result we hand back from the cursor walk, the running total plus the trail
// of steps so the ui can show the cursor crawling record by record
export interface CursorWalk {
  total: number; // summed amount across the category
  count: number; // how many records the cursor visited
  steps: string[]; // one human line per cursor stop, for teaching
}

// totalByCategoryWithCursor opens a cursor on the category index and walks it one
// record at a time, summing amounts, a cursor is the right tool when you want to
// touch records one by one, paginate, or stop early, instead of materializing all
export async function totalByCategoryWithCursor(
  category: string,
): Promise<CursorWalk> {
  return withStore("readonly", async (store) => {
    const index = store.index(IDX_CATEGORY);
    const range = IDBKeyRange.only(category);
    log("cursor", `openCursor on index "${IDX_CATEGORY}" for "${category}"`);

    // a cursor does not fit promisify cleanly because onsuccess fires REPEATEDLY,
    // once per record, so we hand roll the loop with our own promise here
    return new Promise<CursorWalk>((resolve, reject) => {
      const walk: CursorWalk = { total: 0, count: 0, steps: [] };
      const cursorRequest = index.openCursor(range);

      // onsuccess fires once per step, request.result is the cursor or null at the end
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          // cursor.value is the full record at the current position
          const record = cursor.value as Expense;
          walk.total += record.amount;
          walk.count += 1;
          const step = `step ${walk.count}: visited key ${record.id} "${record.name}" +${record.amount}, running total ${walk.total}`;
          walk.steps.push(step);
          log("cursor", step);
          // continue advances to the next matching record, which fires onsuccess
          // again, this re entrant loop is the part everyone trips on at first
          cursor.continue();
        } else {
          // a null cursor means we walked off the end, the loop is done
          log("cursor", `cursor exhausted, visited ${walk.count} record(s)`);
          resolve(walk);
        }
      };

      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  });
}

// ---------------------------------------------------------------------------
// blobs: prove indexeddb stores binary, not just json text
// ---------------------------------------------------------------------------

// readReceiptURL fetches one record and turns its stored blob into an object url
// the caller can drop straight into an img src, the blob round trips through the
// db as actual bytes, no base64, no string encoding, indexeddb keeps it as a blob
export async function readReceiptURL(id: number): Promise<string | null> {
  const record = await getExpense(id);
  if (!record?.receipt) {
    return null;
  }
  // createObjectURL hands back a blob: url pointing at the bytes we just read out
  // callers must revokeObjectURL later to free it, the ui does that on unmount
  const url = URL.createObjectURL(record.receipt);
  log("blob", `read blob for key ${id}, ${record.receipt.size} bytes, made object url`);
  return url;
}

// ---------------------------------------------------------------------------
// inspector data: what the db looks like right now
// ---------------------------------------------------------------------------

// IndexInfo and StoreInfo describe the live schema so the inspector can render it
// without the component needing to know any indexeddb specifics
export interface IndexInfo {
  name: string;
  keyPath: string; // joined if compound, eg "category, date"
}

export interface InspectorSnapshot {
  dbName: string;
  version: number;
  storeName: string;
  keyPath: string;
  autoIncrement: boolean;
  indexes: IndexInfo[];
  recordCount: number;
  quotaUsed: number | null; // bytes used, null if the browser will not estimate
  quotaTotal: number | null; // bytes available
}

// inspect reads the current schema and counts, plus the storage estimate, this is
// called after every operation so the inspector always mirrors reality
export async function inspect(): Promise<InspectorSnapshot> {
  const db = await getDB();
  const recordCount = await countExpenses();

  // read the store and index metadata straight off the live connection
  // we open a throwaway readonly transaction just to reach the store handle
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const indexes: IndexInfo[] = Array.from(store.indexNames).map((name) => {
    const idx = store.index(name);
    // keyPath is a string for single field indexes, or an array for compound ones
    const keyPath = Array.isArray(idx.keyPath)
      ? idx.keyPath.join(", ")
      : idx.keyPath;
    return { name, keyPath };
  });
  // keyPath on the store itself is typed string | string[] | null, null is for
  // stores with out-of-line keys, ours always has keyPath "id" so we coalesce the
  // impossible null away to keep the snapshot type a plain string
  const storeKeyPath = Array.isArray(store.keyPath)
    ? store.keyPath.join(", ")
    : (store.keyPath ?? "id");
  tx.abort(); // we only read metadata, nothing to commit, abort is cleanest

  // navigator.storage.estimate reports the origin quota, used vs available,
  // it is approximate by design so browsers do not leak exact disk usage
  let quotaUsed: number | null = null;
  let quotaTotal: number | null = null;
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    quotaUsed = est.usage ?? null;
    quotaTotal = est.quota ?? null;
  }

  return {
    dbName: DB_NAME,
    version: db.version,
    storeName: STORE,
    keyPath: storeKeyPath,
    autoIncrement: store.autoIncrement,
    indexes,
    recordCount,
    quotaUsed,
    quotaTotal,
  };
}

// ---------------------------------------------------------------------------
// the schema migration trigger, the moment versioning clicks
// ---------------------------------------------------------------------------

// migrateToV2 bumps the persisted version to 2, drops the cached v1 connection,
// and reopens at v2 which forces onupgradeneeded to run the compound index
// migration on the EXISTING data, no records are lost, only the schema grows
export async function migrateToV2(): Promise<void> {
  if (currentVersion() >= 2) {
    log("info", "already at schema v2, nothing to migrate");
    return;
  }
  log("upgrade", "bumping schema version 1 -> 2, reopening to trigger migration");

  // close the current connection first, an open v1 connection would block the
  // v2 open and fire onblocked instead of upgrading
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }

  // remember the new version so refreshes stay on v2, then open at v2
  setVersion(2);
  dbPromise = openDB(2);
  await dbPromise;
}

// resetDatabase is the replay button for the demo, it deletes the whole database
// and forgets the version so the next open recreates the schema fresh at v1, this
// is the honest way to start over, note we cannot just open at a lower version,
// indexeddb refuses to open below the version already on disk, deletion is the
// only real way back to v1, deleteDatabase is itself a versioned request so it
// blocks until every open connection closes, which is why we drop our cache first
export async function resetDatabase(): Promise<void> {
  log("info", "reset requested, deleting the entire database");
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      log("info", "database deleted, all records gone, schema reset");
      resolve();
    };
    request.onerror = () => reject(request.error);
    // onblocked means a connection in another tab is still holding the db open
    request.onblocked = () =>
      log("info", "delete blocked, another tab still has the db open");
  });
  // forget the remembered version so the next open starts the story at v1 again
  setVersion(1);
}
