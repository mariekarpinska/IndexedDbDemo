# Receipt Vault

A tiny expense tracker whose real purpose is to **teach IndexedDB by showing it
happen live**. Every action you take narrates exactly what IndexedDB just did —
which transaction opened, which request succeeded, what key got assigned, when the
transaction committed — so the invisible request / transaction / cursor machinery
becomes something you can watch.

Built with **Vite + React + TypeScript**, no backend, no router, and **no Dexie or
any IndexedDB wrapper**. The only abstraction over the raw API is a hand-written,
fully typed `promisify<T>(request: IDBRequest<T>)` in `src/db.ts`. All storage
logic lives in that one module and reads top to bottom like a guided tour.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL. Type-check / production build:

```bash
npm run build
```

## A suggested tour (do these in order)

Each step lights up a different IndexedDB concept. Keep the **event log** (the
teal "till tape" on the right) and the **DB Inspector** above it in view — they
react to everything.

1. **Add a few expenses.** Fill the form, optionally upload a receipt image, and
   hit **Print to vault**. Watch the log narrate `opened transaction (readwrite)`,
   `add succeeded, store assigned key N`, `transaction committed` — and the new
   receipt _prints in_ at the top of the roll. That print-in is the visual moment
   the write committed. The inspector's record count pulses.
   → demonstrates `open`, `add`, auto-incrementing keys, transaction lifecycle.

2. **Add several more, then scroll the roll.** It handles many records happily.

3. **Refresh the page.** Everything is still there. The banner explains why: this
   data persisted to disk. If it lived in React state it would be gone, and
   `sessionStorage` would not survive a tab close.
   → demonstrates persistence vs in-memory state.

4. **Close the tab and reopen it.** Still there — unlike `sessionStorage`.
   → drives the persistence point home.

5. **Filter "this month".** Uses an `IDBKeyRange.bound(start, end)` query on the
   `date` **index** — the log says so, and notes it is an index range, not a full
   scan. Then **filter by category** (an exact index lookup). Hit **Show all** to
   clear.
   → demonstrates indexes and key ranges.

6. **Run a cursor total.** Pick a category and **Run cursor total**. The log
   prints one line per `cursor.continue()` step while a running total builds, and
   the result panel shows the trail. The cursor loop is the weirdest part of the
   API, so every stop is narrated.
   → demonstrates `openCursor` and the re-entrant cursor loop.

7. **Open a receipt.** Any expense you uploaded an image for shows a thumbnail —
   that image round-tripped through IndexedDB as a real `Blob` (read back with
   `URL.createObjectURL`), proving the store holds binary, not just strings.
   → demonstrates Blob storage.

8. **Upgrade the schema to v2.** In the Schema Migration panel, hit **Upgrade
   schema to v2**. The DB reopens at a higher version, which fires
   `onupgradeneeded` and adds a compound index `[category, date]` to your
   _existing_ records — no data lost. The inspector's version flips `v1 → v2` and
   the new index appears in the index list.
   → demonstrates versioning and migrations, the moment it clicks.

9. **(Optional) Reset database.** Deletes the whole database and starts fresh at
   v1, so you can replay the migration story.

Want the other side of the glass? Open your browser DevTools → **Application** →
**IndexedDB** → `receipt-vault` and watch the same `expenses` store from the
browser's own inspector while you poke the app.

## Where to read

- **`src/db.ts`** — the whole IndexedDB layer: the typed `Expense` / `NewExpense`
  records, the generic `promisify<T>` wrapper, schema creation in
  `onupgradeneeded`, CRUD, index range queries, the cursor walk, Blob read-back,
  the v1 → v2 migration, and the narration stream. Heavily commented; read it like
  prose.
- **`src/App.tsx`** — wires the db layer to the UI and re-inspects after every op.
- **`src/components/`** — the form, the receipt roll, the inspector, the event
  log, the query tools, and the schema panel.
- **`src/index.css`** — one hand-written sheet; all color and type derive from the
  receipt-paper / vault-teal token system at the top.

## Notes

- Type-checks cleanly under `strict` with no `any`.
- Responsive down to mobile, visible focus rings, and `prefers-reduced-motion`
  is respected (the print-in and pulse animations are disabled when you ask the
  OS to reduce motion).
