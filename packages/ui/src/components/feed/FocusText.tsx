import { Fragment, useMemo } from "react";
import { applyFocusMode, type FocusOptions } from "@freed/shared";

export function FocusText({ text, options }: { text: string; options: FocusOptions }) {
  const elements = useMemo(() => {
    const segments = applyFocusMode(text, options);
    return segments.map((seg, i) =>
      seg.emphasis
        ? <span key={i} className="theme-focus-text__emphasis">{seg.text}</span>
        : <Fragment key={i}>{seg.text}</Fragment>,
    );
  }, [text, options]);

  return (
    <div className="theme-focus-text" data-focus-intensity={options.intensity}>
      {elements}
    </div>
  );
}
