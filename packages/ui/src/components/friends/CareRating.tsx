import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "../Tooltip.js";

export type CareLevel = 1 | 2 | 3 | 4 | 5;

export function careLevelLabel(level: number): string {
  return level <= 2 ? "Connection" : level <= 4 ? "Friend" : "Fam";
}

/** Five-stop closeness control using the existing stored relationship values. */
export function CareRating({ level, onChange }: {
  level: CareLevel;
  onChange?: (level: CareLevel) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<CareLevel | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const writing = useRef(false);
  const measure = useRef<HTMLSpanElement>(null);
  const [handleWidth, setHandleWidth] = useState(0);
  useLayoutEffect(() => {
    const element = measure.current;
    if (!element) return;
    const update = () => setHandleWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const commit = async (value: CareLevel) => {
    if (!onChange || writing.current) return;
    if (value === level) { setPreview(null); return; }
    writing.current = true;
    setPending(true);
    setError(false);
    try { await onChange(value); } catch { setError(true); }
    finally { writing.current = false; setPending(false); setPreview(null); }
  };
  return (
    <div className="w-full min-w-0" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Tooltip label="Importance in My Life" side="top" className="block w-full">
      <div className="friend-closeness-control" style={{
        "--care-handle-width": handleWidth ? `${handleWidth}px` : "7rem",
        "--care-position": ((preview ?? level) - 1) / 4,
      } as CSSProperties}>
      <span ref={measure} className="friend-closeness-handle friend-closeness-measure" aria-hidden="true">Connection</span>
      <div className="friend-closeness-track" aria-hidden="true">
        {[1, 2, 3, 4, 5].map(stop => <span key={stop} />)}
      </div>
      <span className="friend-closeness-handle friend-closeness-position" aria-hidden="true">{careLevelLabel(preview ?? level)}</span>
      <input type="range" min={1} max={5} step={1}
        className="friend-closeness-slider"
        aria-label="Relationship closeness"
        aria-valuetext={careLevelLabel(preview ?? level) + ", position " + (preview ?? level).toLocaleString() + " of 5"}
        value={preview ?? level} disabled={!onChange || pending}
        onChange={event => setPreview(Number(event.target.value) as CareLevel)}
        onPointerUp={event => void commit(Number(event.currentTarget.value) as CareLevel)}
        onPointerCancel={() => setPreview(null)}
        onKeyUp={event => { event.stopPropagation(); void commit(Number(event.currentTarget.value) as CareLevel); }}
        onBlur={event => void commit(Number(event.currentTarget.value) as CareLevel)}
      />
      </div>
      </Tooltip>
      {error && <p role="alert" className="text-xs theme-feedback-text-warning">Could not save the relationship setting. Please try again.</p>}
    </div>
  );
}
