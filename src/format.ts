// small pure formatting helpers, no indexeddb in here, kept out of the db module
// so db.ts stays a clean storage tour

// money formats a number as a plain currency-ish string for the receipt line items
// we keep it locale simple on purpose, two decimals with a leading dollar sign
export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// bytes turns a raw byte count into a short human readable size for the quota
// readout in the inspector, returns a dash when the browser declined to estimate
export function bytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// monthBounds returns the first and last iso date of the month containing `ref`,
// used to build the IDBKeyRange for the "this month" index filter, returning iso
// strings keeps the comparison lexicographic which is how the date index sorts
export function monthBounds(ref: Date): { start: string; end: string } {
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0); // day 0 of next month is last of this
  return { start: toISODate(first), end: toISODate(last) };
}

// toISODate formats a Date as yyyy-mm-dd in local time, the html date input and
// our stored date field both speak this format so everything lines up
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
