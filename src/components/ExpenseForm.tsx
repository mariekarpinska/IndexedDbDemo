import { useRef, useState, type FormEvent } from "react";
import { CATEGORIES, type NewExpense } from "../db";
import { toISODate } from "../format";

// the form collects one NewExpense, note NewExpense has no id, the store assigns
// that on write, the form literally cannot invent a key and that is the lesson
interface Props {
  onSave: (expense: NewExpense) => Promise<void>;
}

export function ExpenseForm({ onSave }: Props) {
  // controlled fields for the text-ish inputs
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [date, setDate] = useState(toISODate(new Date()));
  // the uploaded receipt blob, optional, lives outside the controlled inputs
  const [receipt, setReceipt] = useState<Blob | undefined>(undefined);
  const [receiptName, setReceiptName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // we keep a ref to the file input so we can clear it after a successful save
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      // assemble the NewExpense, amount is parsed to a real number not a string
      const expense: NewExpense = {
        name: name.trim(),
        amount: Number(amount),
        category,
        date,
        receipt, // a Blob or undefined, indexeddb stores it as-is
      };
      await onSave(expense);
      // reset the form for the next entry, keep the date and category sticky
      // since people often log several at once
      setName("");
      setAmount("");
      setReceipt(undefined);
      setReceiptName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && amount !== "" && Number(amount) >= 0;

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field field-wide">
          <span className="field-label">receipt image</span>
          <input
            ref={fileInputRef}
            className="field-input"
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // a File IS a Blob, so we can hand it straight to the store
              setReceipt(file ?? undefined);
              setReceiptName(file?.name ?? "");
            }}
          />
          {receiptName && <span className="field-hint">{receiptName}</span>}
        </label>

        <label className="field field-wide">
          <span className="field-label">name</span>
          <input
            className="field-input"
            type="text"
            placeholder="train ticket"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">amount</span>
          <input
            className="field-input mono"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">category</span>
          <select
            className="field-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">date</span>
          <input
            className="field-input mono"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
      </div>

      <button className="btn-print" type="submit" disabled={!canSave || saving}>
        {saving ? "printing…" : "print to vault"}
      </button>
    </form>
  );
}
