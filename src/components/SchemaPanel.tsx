import { useState } from "react";

interface Props {
  version: number; // current schema version, drives the button label and state
  onMigrate: () => Promise<void>; // bump to v2 and run onupgradeneeded
  onReset: () => Promise<void>; // delete the db and start over at v1
}

// the schema panel makes versioning tangible, you ship at v1 then opt in to v2,
// the migration adds a compound index inside onupgradeneeded on your EXISTING data
// and the inspector version flips, that is the moment versioning clicks
export function SchemaPanel({ version, onMigrate, onReset }: Props) {
  const [busy, setBusy] = useState(false);

  async function migrate() {
    setBusy(true);
    try {
      await onMigrate();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    // a real destructive action, confirm so a curious click does not nuke the demo
    if (!window.confirm("delete the whole database and start over at v1?")) return;
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="schema">
      <h3 className="tool-title">schema migration</h3>
      {version < 2 ? (
        <>
          <p className="tool-note">
            you are on <strong>v1</strong>: indexes on <code>date</code> and{" "}
            <code>category</code>. upgrading to <strong>v2</strong> reopens the db
            at a higher version, which fires <code>onupgradeneeded</code> and adds
            a compound index <code>[category, date]</code> to your existing
            records. nothing is lost, the schema just grows.
          </p>
          <button
            className="btn-print"
            type="button"
            onClick={migrate}
            disabled={busy}
          >
            {busy ? "migrating…" : "upgrade schema to v2"}
          </button>
        </>
      ) : (
        <p className="tool-note">
          you are on <strong>v2</strong>: the compound index{" "}
          <code>[category, date]</code> is live. check it in the inspector index
          list above. the migration ran on your existing data without dropping a
          single record.
        </p>
      )}

      <button className="btn-link" type="button" onClick={reset} disabled={busy}>
        reset database (delete everything, back to v1)
      </button>
    </section>
  );
}
