import { MessageContent } from "../../components/MessageContent";
import { StreamdownMessage } from "./StreamdownMessage";
import { StreamStats } from "./StreamStats";

export type TranscriptRendererId = "react-markdown" | "streamdown";

export interface TranscriptRenderProps {
  content: string;
  streaming: boolean;
}

type TranscriptRenderer = (props: TranscriptRenderProps) => JSX.Element | null;

const renderers: Record<TranscriptRendererId, TranscriptRenderer> = {
  "react-markdown": ({ content, streaming }) => (
    // Stream as plain text (cheap), then finalize to markdown once the
    // stream settles. Avoids re-parsing the whole answer with
    // react-markdown + remark-gfm on every animation frame — the dominant
    // per-frame cost during token streaming. Mirrors the main chat and the
    // playground's "lighter streaming path" design decision.
    <>
      <MessageContent
        content={content}
        streaming={streaming}
        streamingRenderMode="plain"
      />
      <StreamStats content={content} streaming={streaming} />
    </>
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

