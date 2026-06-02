import { memo, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ThinkingIndicator } from "../../components/ThinkingIndicator";

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
                // A short fade keeps rendered words in step with the token
                // stream; a longer one (e.g. 600ms) makes words visibly
                // trail generation on fast on-device streams.
                animation: "fadeIn",
                duration: 150,
                easing: "ease-in-out",
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
    </div>
  );
}

export const StreamdownMessage = memo(StreamdownMessageImpl);

