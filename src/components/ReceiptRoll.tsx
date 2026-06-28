import { useEffect, useState } from "react";
import type { Expense } from "../db";
import { money } from "../format";

interface RollProps {
  expenses: Expense[];
  newestId: number | null; // the key that just printed, gets the print-in animation
  reducedMotion: boolean;
  filterLabel: string | null; // when a filter is active we say so on the roll header
  onDelete: (id: number) => void;
}

// the receipt roll is the signature element, a continuous thermal tape where each
// expense is one printed segment, the empty state reads like a blank roll waiting
export function ReceiptRoll({
  expenses,
  newestId,
  reducedMotion,
  filterLabel,
  onDelete,
}: RollProps) {
  return (
    <section className="roll" aria-label="expense receipts">
      <header className="roll-head">
        <span className="roll-title">the vault roll</span>
        <span className="roll-sub">
          {filterLabel
            ? `showing ${expenses.length} · ${filterLabel}`
            : `${expenses.length} receipt${expenses.length === 1 ? "" : "s"} on file`}
        </span>
      </header>

      {expenses.length === 0 ? (
        <div className="roll-empty">
          <div className="perf" aria-hidden="true" />
          <p className="empty-line">— blank roll —</p>
          <p className="empty-hint">
            no receipts vaulted yet. fill the form above and hit{" "}
            <strong>print to vault</strong> to write your first record to
            indexeddb and watch it print in here.
          </p>
          <div className="perf" aria-hidden="true" />
        </div>
      ) : (
        <ol className="roll-list">
          {expenses.map((expense) => (
            <ReceiptSegment
              key={expense.id}
              expense={expense}
              isNew={expense.id === newestId && !reducedMotion}
              onDelete={onDelete}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface SegmentProps {
  expense: Expense;
  isNew: boolean;
  onDelete: (id: number) => void;
}

// one receipt segment, perforated top edge, monospace line items, a VAULTED stamp
// once it is persisted, which it always is here because it came out of the db
function ReceiptSegment({ expense, isNew, onDelete }: SegmentProps) {
  // turn the stored blob into an object url for the thumbnail, the blob came back
  // out of indexeddb via getAll, so rendering it proves the db held real binary
  const [thumbURL, setThumbURL] = useState<string | null>(null);

  useEffect(() => {
    if (!expense.receipt) {
      setThumbURL(null);
      return;
    }
    // createObjectURL points a short lived url at the blob bytes in memory
    const url = URL.createObjectURL(expense.receipt);
    setThumbURL(url);
    // revoke on cleanup so we do not leak object urls as the list re renders
    return () => URL.revokeObjectURL(url);
  }, [expense.receipt]);

  return (
    <li className={`segment${isNew ? " segment-printing" : ""}`}>
      {/* perforated tear edge made of --rule dots */}
      <div className="perf" aria-hidden="true" />

      <div className="segment-body">
        <div className="segment-top">
          <span className="segment-name">{expense.name}</span>
          <span className="segment-amount mono">{money(expense.amount)}</span>
        </div>

        <dl className="segment-meta mono">
          <div className="meta-row">
            <dt>key</dt>
            <dd>#{expense.id}</dd>
          </div>
          <div className="meta-row">
            <dt>cat</dt>
            <dd>{expense.category}</dd>
          </div>
          <div className="meta-row">
            <dt>date</dt>
            <dd>{expense.date}</dd>
          </div>
        </dl>

        {thumbURL && (
          <img
            className="segment-thumb"
            src={thumbURL}
            alt={`receipt for ${expense.name}`}
          />
        )}

        <div className="segment-foot">
          <span className="stamp" aria-label="persisted to indexeddb">
            vaulted
          </span>
          <button
            className="btn-delete mono"
            type="button"
            onClick={() => onDelete(expense.id)}
            aria-label={`delete ${expense.name}`}
          >
            delete
          </button>
        </div>
      </div>
    </li>
  );
}
