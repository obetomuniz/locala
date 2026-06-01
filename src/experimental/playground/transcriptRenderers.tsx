import { MessageContent } from "../../components/MessageContent";
import { StreamdownMessage } from "./StreamdownMessage";

export type TranscriptRendererId = "react-markdown" | "streamdown";

export interface TranscriptRenderProps {
  content: string;
  streaming: boolean;
}

type TranscriptRenderer = (props: TranscriptRenderProps) => JSX.Element | null;

const renderers: Record<TranscriptRendererId, TranscriptRenderer> = {
  "react-markdown": ({ content, streaming }) => (
    <MessageContent
      content={content}
      streaming={streaming}
      streamingRenderMode="markdown"
    />
  ),
  streamdown: ({ content, streaming }) => (
    <StreamdownMessage content={content} streaming={streaming} />
  ),
};

export function resolveTranscriptRenderer(
  id?: TranscriptRendererId,
): TranscriptRenderer {
  return id ? renderers[id] : renderers["react-markdown"];
}

