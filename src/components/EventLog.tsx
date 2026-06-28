import { useEffect, useRef, useState } from "react";
import { subscribeToLog, type LogEntry } from "../db";

// the event log is the till tape, it prints one plain english line per indexeddb
// lifecycle event so the otherwise invisible request and transaction machinery is
// something you can actually watch scroll by
export function EventLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const tapeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // subscribe to the db narration stream, every db operation calls log() which
    // fans out to here, we keep the last 120 lines so the tape does not grow forever
    const unsubscribe = subscribeToLog((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 120 ? next.slice(next.length - 120) : next;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // keep the tape scrolled to the freshest line as new ones print
    const tape = tapeRef.current;
    if (tape) tape.scrollTop = tape.scrollHeight;
  }, [entries]);

  return (
    <div className="eventlog">
      <h2 className="eventlog-title">event log · till tape</h2>
      <div className="tape" ref={tapeRef} role="log" aria-live="polite">
        {entries.length === 0 ? (
          <p className="tape-empty mono">
            waiting for the first operation… do something above
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.seq} className={`tape-line kind-${entry.kind} mono`}>
              <span className="tape-time">{entry.time}</span>
              <span className="tape-kind">{entry.kind}</span>
              <span className="tape-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
