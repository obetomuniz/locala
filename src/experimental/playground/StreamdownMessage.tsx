import { memo } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ThinkingIndicator } from "../../components/ThinkingIndicator";

interface Props {
  content: string;
  streaming?: boolean;
}

function StreamdownMessageImpl({ content, streaming }: Props) {
  if (!content) {
    return streaming ? <ThinkingIndicator /> : null;
  }

  return (
    <div className="agentp__streamdown">
      <Streamdown
        mode="streaming"
        animated={
          streaming
            ? {
                animation: "fadeIn",
                duration: 95,
                stagger: 7,
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
      {streaming && <span className="caret md__caret" />}
    </div>
  );
}

export const StreamdownMessage = memo(StreamdownMessageImpl);

