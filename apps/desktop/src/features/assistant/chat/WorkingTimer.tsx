import { memo, useEffect, useRef } from "react";
import { formatDuration } from "./session-logic";

export function formatLiveElapsed(startIso: string, nowMs: number): string | null {
  const startedAtMs = Date.parse(startIso);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  return formatDuration(Math.max(0, nowMs - startedAtMs));
}

export const WorkingTimer = memo(function WorkingTimer(props: { startedAtIso: string }) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const initialText = formatLiveElapsed(props.startedAtIso, Date.now());

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatLiveElapsed(props.startedAtIso, Date.now()) ?? "";
      }
    };
    updateText();
    const intervalId = window.setInterval(updateText, 1_000);
    return () => window.clearInterval(intervalId);
  }, [props.startedAtIso]);

  return <span ref={textRef}>{initialText}</span>;
});
