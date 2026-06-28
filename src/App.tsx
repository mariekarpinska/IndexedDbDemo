import { useCallback, useEffect, useRef, useState } from "react";
import {
  addExpense,
  currentVersion,
  deleteExpense,
  getAllExpenses,
  getByCategory,
  getByDateRange,
  inspect,
  migrateToV2,
  resetDatabase,
  type Expense,
  type InspectorSnapshot,
  type NewExpense,
} from "./db";
import { monthBounds } from "./format";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { ExpenseForm } from "./components/ExpenseForm";
import { ReceiptRoll } from "./components/ReceiptRoll";
import { DBInspector } from "./components/DBInspector";
import { EventLog } from "./components/EventLog";
import { QueryTools } from "./components/QueryTools";
import { SchemaPanel } from "./components/SchemaPanel";

export default function App() {
  // the roll contents, which may be the full set or a filtered subset
  const [expenses, setExpenses] = useState<Expense[]>([]);
  // the live db snapshot powering the inspector, re-read after every operation
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);
  // the key that just printed, drives the one-shot print-in animation on the roll
  const [newestId, setNewestId] = useState<number | null>(null);
  // a human label for the active filter, null means "showing everything"
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  // mirror of the persisted schema version so the schema panel re-renders on bump
  const [version, setVersion] = useState<number>(currentVersion());

  const reducedMotion = usePrefersReducedMotion();
  // a timer handle so a rapid second save cancels the previous animation cleanup
  const printTimer = useRef<number | null>(null);

  // refreshInspector re-reads the schema, count, and quota, called after every op
  // so the inspector never drifts from the real state of the database
  const refreshInspector = useCallback(async () => {
    const snap = await inspect();
    setSnapshot(snap);
    setVersion(snap.version);
  }, []);

  // loadAll pulls the full record set and clears any active filter
  const loadAll = useCallback(async () => {
    const all = await getAllExpenses();
    setExpenses(all);
    setActiveFilter(null);
  }, []);

  // on first mount, open the db implicitly through the first read and paint the ui
  useEffect(() => {
    void (async () => {
      await loadAll();
      await refreshInspector();
    })();
  }, [loadAll, refreshInspector]);

  // saving writes one new record, then flags it as newest so it prints in, then
  // reloads the roll and re-inspects, the print-in is the visual commit moment
  async function handleSave(expense: NewExpense) {
    const id = await addExpense(expense);
    setNewestId(id);
    await loadAll();
    await refreshInspector();
    // clear the newest flag after the animation window so it only plays once
    if (printTimer.current) window.clearTimeout(printTimer.current);
    printTimer.current = window.setTimeout(() => setNewestId(null), 1200);
  }

  // deleting removes one record then reloads the full set and re-inspects
  async function handleDelete(id: number) {
    await deleteExpense(id);
    await loadAll();
    await refreshInspector();
  }

  // filter by the current month using an index range query on date
  async function handleFilterMonth() {
    const { start, end } = monthBounds(new Date());
    const rows = await getByDateRange(start, end);
    setExpenses(rows);
    setActiveFilter(`this month · ${start} → ${end}`);
    await refreshInspector();
  }

  // filter by category using an exact index lookup
  async function handleFilterCategory(category: string) {
    const rows = await getByCategory(category);
    setExpenses(rows);
    setActiveFilter(`category = ${category}`);
    await refreshInspector();
  }

  // bump the schema to v2, run the migration, then refresh everything
  async function handleMigrate() {
    await migrateToV2();
    await loadAll();
    await refreshInspector();
  }

  // delete the database entirely and rebuild fresh at v1
  async function handleReset() {
    await resetDatabase();
    await loadAll();
    await refreshInspector();
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-mark">
          <span className="mark-rule" aria-hidden="true" />
          <h1 className="title">Receipt Vault</h1>
          <span className="mark-rule" aria-hidden="true" />
        </div>
        <p className="tagline">
          a tiny expense tracker that narrates exactly what{" "}
          <strong>IndexedDB</strong> is doing, live. every action prints to the
          till tape on the right.
        </p>
      </header>

      {/* persistence callout, the core "why indexeddb" pitch */}
      <aside className="banner">
        <p>
          <strong>refresh this page.</strong> your receipts are still here
          because IndexedDB persists to disk. if this list lived in React state
          it would be gone, and <code>sessionStorage</code> would die when you
          close the tab. this survives both. close the tab and reopen it to feel
          the difference.
        </p>
      </aside>

      <main className="layout">
        <div className="column-main">
          <section className="panel form-panel">
            <h2 className="panel-title">log an expense</h2>
            <p className="panel-help">
              upload a receipt, fill the fields, and print it to the vault. the
              record gets an auto-incremented key the instant it is written.
            </p>
            <ExpenseForm onSave={handleSave} />
          </section>

          <QueryTools
            onFilterMonth={handleFilterMonth}
            onFilterCategory={handleFilterCategory}
            onShowAll={loadAll}
            activeFilter={activeFilter}
          />

          <ReceiptRoll
            expenses={expenses}
            newestId={newestId}
            reducedMotion={reducedMotion}
            filterLabel={activeFilter}
            onDelete={handleDelete}
          />

          <SchemaPanel
            version={version}
            onMigrate={handleMigrate}
            onReset={handleReset}
          />
        </div>

        {/* the side rail is the machine you are peering into, --vault teal */}
        <aside className="rail">
          <div className="rail-sticky">
            <DBInspector snapshot={snapshot} reducedMotion={reducedMotion} />
            <EventLog />
          </div>
        </aside>
      </main>

      <footer className="colophon mono">
        receipt vault · raw indexeddb, no wrapper libs · open devtools →
        application → indexeddb to see the same store from the other side
      </footer>
    </div>
  );
}
