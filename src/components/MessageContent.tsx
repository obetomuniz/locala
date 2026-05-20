import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingIndicator } from "./ThinkingIndicator";

interface Props {
  content: string;
  streaming?: boolean;
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

function MessageContentImpl({ content, streaming }: Props) {
  if (!content) {
    return streaming ? <ThinkingIndicator /> : null;
  }
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {streaming && <span className="caret md__caret" />}
    </div>
  );
}

export const MessageContent = memo(MessageContentImpl);
