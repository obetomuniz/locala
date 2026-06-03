import { memo, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ThinkingIndicator } from "../../components/ThinkingIndicator";
import { StreamStats } from "./StreamStats";

interface Props {
  content: string;
  streaming?: boolean;
}

function StreamdownMessageImpl({ content, streaming }: Props) {
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (streaming) {
      setSettling(false);
      return;
    }

    if (!content) {
      setSettling(false);
      return;
    }

    setSettling(true);
    const settleId = window.setTimeout(() => setSettling(false), 140);
    return () => {
      window.clearTimeout(settleId);
    };
  }, [content, streaming]);

  if (!content) {
    return streaming ? <ThinkingIndicator /> : null;
  }

  return (
    <div
      className={`agentp__streamdown${settling ? " agentp__streamdown--settling" : ""}`}
    >
      <Streamdown
        mode="streaming"
        caret="circle"
        animated={
          streaming
            ? {
                // Keep the fade very short so rendered words stay in step
                // with the token stream. Throughput is model-bound (the
                // on-device token rate is the ceiling), so a long fade just
                // makes words visibly trail generation and reads as sluggish.
                // 40ms is a subtle smoothing pass without the lag.
                animation: "fadeIn",
                duration: 40,
                easing: "ease-out",
                sep: "word",
              }
            : false
        }
        isAnimating={!!streaming}
        skipHtml
        parseIncompleteMarkdown
      >
        {content}
      </Streamdown>
      <StreamStats content={content} streaming={streaming} />
    </div>
  );
}

export const StreamdownMessage = memo(StreamdownMessageImpl);
