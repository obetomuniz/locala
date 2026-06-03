import { memo, useEffect, useRef, useState } from "react";

interface Props {
  content: string;
  streaming?: boolean;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Self-contained streaming-speed counter shown under a rendered message:
 * elapsed time from the first streamed chunk plus char/word throughput.
 * Drop it into any transcript renderer so every preset reports speed
 * identically. Manages its own timing — pass `content` and `streaming`.
 */
function StreamStatsImpl({ content, streaming }: Props) {
  const startRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!content) {
      startRef.current = null;
      setElapsedMs(0);
      return;
    }
    if (streaming && startRef.current === null) {
      startRef.current = performance.now();
    }
    if (startRef.current !== null) {
      setElapsedMs(performance.now() - startRef.current);
    }
  }, [content, streaming]);

  if (!content) return null;

  const chars = content.length;
  const words = countWords(content);
  const seconds = elapsedMs / 1000;
  const charsPerSec = seconds > 0 ? chars / seconds : 0;
  const wordsPerSec = seconds > 0 ? words / seconds : 0;

  return (
    <div
      className="agentp__stream-stats"
      aria-live="polite"
      title="Streaming speed counter"
    >
      <span className="agentp__stream-stat">{seconds.toFixed(1)}s</span>
      <span className="agentp__stream-stat">{words} words</span>
      <span className="agentp__stream-stat">{chars} chars</span>
      <span className="agentp__stream-stat">{charsPerSec.toFixed(0)} ch/s</span>
      <span className="agentp__stream-stat">{wordsPerSec.toFixed(1)} w/s</span>
      <span className="agentp__stream-stat">
        {streaming ? "streaming" : "done"}
      </span>
    </div>
  );
}

export const StreamStats = memo(StreamStatsImpl);
