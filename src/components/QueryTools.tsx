import { useState } from "react";
import { CATEGORIES, totalByCategoryWithCursor, type CursorWalk } from "../db";
import { money } from "../format";

interface Props {
  onFilterMonth: () => void; // index range query on date for the current month
  onFilterCategory: (category: string) => void; // index lookup on category
  onShowAll: () => void; // clear the filter, getAll again
  activeFilter: string | null; // label of the current filter or null
}

// the query tools demonstrate the index-backed reads, each button maps to one
// real indexeddb query and the event log narrates whether it used an index or a
// cursor, so the abstract "indexes avoid full scans" claim becomes observable
export function QueryTools({
  onFilterMonth,
  onFilterCategory,
  onShowAll,
  activeFilter,
}: Props) {
  const [cursorCat, setCursorCat] = useState<string>(CATEGORIES[0]);
  const [walk, setWalk] = useState<CursorWalk | null>(null);
  const [walking, setWalking] = useState(false);

  async function runCursor() {
    setWalking(true);
    try {
      // this opens a cursor on the category index and walks it one record at a
      // time, the returned walk carries the per-step trail for the readout below
      const result = await totalByCategoryWithCursor(cursorCat);
      setWalk(result);
    } finally {
      setWalking(false);
    }
  }

  return (
    <section className="tools">
      <div className="tool-block">
        <h3 className="tool-title">query by index</h3>
        <p className="tool-note">
          these read through the <strong>date</strong> and{" "}
          <strong>category</strong> indexes, not a full scan. watch the event log
          say so.
        </p>
        <div className="tool-row">
          <button className="btn-ghost" type="button" onClick={onFilterMonth}>
            this month (date range)
          </button>
          <select
            className="field-input"
            aria-label="filter by category"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onFilterCategory(e.target.value);
            }}
          >
            <option value="" disabled>
              filter category…
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            type="button"
            onClick={onShowAll}
            disabled={!activeFilter}
          >
            show all
          </button>
        </div>
        {activeFilter && (
          <p className="tool-active mono">filtered: {activeFilter}</p>
        )}
      </div>

      <div className="tool-block">
        <h3 className="tool-title">walk a cursor</h3>
        <p className="tool-note">
          a cursor crawls one record at a time. pick a category and watch each{" "}
          <code>continue()</code> step print in the log while the running total
          builds.
        </p>
        <div className="tool-row">
          <select
            className="field-input"
            aria-label="cursor category"
            value={cursorCat}
            onChange={(e) => setCursorCat(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            type="button"
            onClick={runCursor}
            disabled={walking}
          >
            {walking ? "walking…" : "run cursor total"}
          </button>
        </div>

        {walk && (
          <div className="cursor-out mono">
            <p className="cursor-total">
              {cursorCat}: {money(walk.total)} across {walk.count} record
              {walk.count === 1 ? "" : "s"}
            </p>
            <ol className="cursor-steps">
              {walk.steps.length === 0 && (
                <li className="dim">cursor found nothing in this category</li>
              )}
              {walk.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
