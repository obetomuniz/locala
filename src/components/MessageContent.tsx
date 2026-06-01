import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingIndicator } from "./ThinkingIndicator";

interface Props {
  content: string;
  streaming?: boolean;
  /**
   * While streaming, render as plain text instead of reparsing markdown on
   * every token. This makes long responses feel much smoother. Final render
   * still uses markdown once streaming ends.
   */
  streamingRenderMode?: "markdown" | "plain";
}

const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = /\blanguage-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="md-inline-code" {...rest}>
        {children}
      </code>
    );
  },
};

function MessageContentImpl({
  content,
  streaming,
  streamingRenderMode = "markdown",
}: Props) {
  if (!content) {
    return streaming ? <ThinkingIndicator /> : null;
  }
  if (streaming && streamingRenderMode === "plain") {
    return (
      <div className="md md--stream-plain">
        {content}
        <span className="caret md__caret" />
      </div>
    );
  }
  const finalizedFromPlain = !streaming && streamingRenderMode === "plain";
  return (
    <div className={`md${finalizedFromPlain ? " md--stream-final" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {streaming && <span className="caret md__caret" />}
    </div>
  );
}

export const MessageContent = memo(MessageContentImpl);
