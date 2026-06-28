import { useEffect, useRef, useState } from "react";
import type { InspectorSnapshot } from "../db";
import { bytes } from "../format";

interface Props {
  snapshot: InspectorSnapshot | null;
  reducedMotion: boolean;
}

// the inspector is the machine you are peering into, styled in --vault teal so it
// reads as a different material from the paper, it mirrors the live schema and
// refreshes after every operation because App re-inspects on every change
export function DBInspector({ snapshot, reducedMotion }: Props) {
  if (!snapshot) {
    return (
      <div className="inspector">
        <h2 className="inspector-title">db inspector</h2>
        <p className="inspector-loading mono">opening connection…</p>
      </div>
    );
  }

  const quotaLabel =
    snapshot.quotaUsed === null
      ? "estimate unavailable"
      : `${bytes(snapshot.quotaUsed)} used of ${bytes(snapshot.quotaTotal)}`;

  return (
    <div className="inspector">
      <h2 className="inspector-title">db inspector</h2>

      <dl className="inspector-grid mono">
        <div className="insp-row">
          <dt>database</dt>
          <dd>{snapshot.dbName}</dd>
        </div>
        <div className="insp-row">
          <dt>version</dt>
          <dd>
            <PulseValue
              value={`v${snapshot.version}`}
              reducedMotion={reducedMotion}
            />
          </dd>
        </div>
        <div className="insp-row">
          <dt>store</dt>
          <dd>{snapshot.storeName}</dd>
        </div>
        <div className="insp-row">
          <dt>keyPath</dt>
          <dd>
            {snapshot.keyPath}
            {snapshot.autoIncrement ? " ++" : ""}
          </dd>
        </div>
        <div className="insp-row">
          <dt>records</dt>
          <dd>
            <PulseValue
              value={String(snapshot.recordCount)}
              reducedMotion={reducedMotion}
            />
          </dd>
        </div>
        <div className="insp-row">
          <dt>quota</dt>
          <dd>
            <PulseValue value={quotaLabel} reducedMotion={reducedMotion} />
          </dd>
        </div>
      </dl>

      <h3 className="inspector-subtitle">indexes</h3>
      <ul className="inspector-indexes mono">
        {snapshot.indexes.length === 0 && <li className="dim">none</li>}
        {snapshot.indexes.map((idx) => (
          <li key={idx.name}>
            <span className="idx-name">{idx.name}</span>
            <span className="idx-path">[{idx.keyPath}]</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PulseProps {
  value: string;
  reducedMotion: boolean;
}

// PulseValue flashes a brief --thermal highlight whenever its text changes, this
// is the one subtle signal that "this number just updated because of an op", we
// compare against the previous render value with a ref and toggle a css class
function PulseValue({ value, reducedMotion }: PulseProps) {
  const prev = useRef(value);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      if (reducedMotion) return; // respect the user, no flashing
      setPulsing(true);
      // clear the highlight after the animation window
      const timer = window.setTimeout(() => setPulsing(false), 900);
      return () => window.clearTimeout(timer);
    }
  }, [value, reducedMotion]);

  return <span className={pulsing ? "pulse" : undefined}>{value}</span>;
}
