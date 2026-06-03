/**
 * Live transcript view. Pure projection of `AgentEvent[]` into a
 * chronological feed of "frames":
 *
 *   step_start         → open a step block
 *   thought            → render an italic line at the top of the step
 *   tool_call          → add a tool card (status: calling)
 *   tool_progress      → append a progress entry to the matching card
 *   tool_result        → close the card (status: ok or error + ms)
 *   step_end           → no visual change (used as a boundary)
 *   text_delta         → append to the running "answer" buffer
 *   message            → set the answer buffer if it's still empty
 *   done               → render a stop reason footer if not "done"
 *
 * The component receives both `events` (for the structured timeline)
 * and `text` (the React-state-managed answer string the hook already
 * accumulates). We render `text` rather than re-deriving from events
 * so the streaming UX matches what `useAgent` exposes elsewhere.
 */

import { useEffect, useMemo, useState } from "react";
import type { A2uiSnapshot } from "../agent/a2ui";
import type { AgentEvent, AgentStopReason } from "../agent/types";
import { A2uiView } from "./a2ui/A2uiView";
import {
  resolveTranscriptRenderer,
  type TranscriptRendererId,
} from "./transcriptRenderers";
import {
  resolveToolRenderer,
  type ToolRendererId,
  type TranscriptToolFrame,
} from "./toolRenderers";

interface Props {
  events: AgentEvent[];
  text: string;
  a2uiSnapshot: A2uiSnapshot;
  /** Thought of the in-flight planning turn, streamed token-by-token. */
  liveThought: { index: number; text: string } | null;
  stopReason: AgentStopReason | null;
  busy: boolean;
  transcriptRendererId?: TranscriptRendererId;
  toolRendererId?: ToolRendererId;
  a2uiEnabled?: boolean;
}

interface StepFrame {
  index: number;
  thought?: string;
  tools: TranscriptToolFrame[];
  isFinal: boolean;
}

interface BuiltTranscript {
  steps: StepFrame[];
  hasStreamedText: boolean;
}

function build(events: AgentEvent[]): BuiltTranscript {
  const steps: StepFrame[] = [];
  let current: StepFrame | null = null;
  let toolByCallId = new Map<string, TranscriptToolFrame>();
  let hasStreamedText = false;

  for (const ev of events) {
    switch (ev.type) {
      case "step_start":
        current = {
          index: ev.index,
          tools: [],
          isFinal: false,
        };
        toolByCallId = new Map();
        steps.push(current);
        break;
      case "step_end":
        break;
      case "step_reset":
        // Retried attempt: clear anything the failed attempt left on the
        // current step frame so it rebuilds cleanly.
        if (current && current.index === ev.index) {
          current.thought = undefined;
          current.tools = [];
          current.isFinal = false;
          toolByCallId = new Map();
        }
        break;
      case "plan_delta":
        break;
      case "thought":
        if (current) current.thought = ev.text;
        break;
      case "plan":
        if (current && ev.plan.final) current.isFinal = true;
        if (current && ev.plan.thought && !current.thought) {
          current.thought = ev.plan.thought;
        }
        break;
      case "tool_call": {
        if (current) {
          const tf: TranscriptToolFrame = {
            callId: ev.callId,
            name: ev.name,
            input: ev.input,
            progress: [],
            pending: true,
          };
          current.tools.push(tf);
          toolByCallId.set(ev.callId, tf);
        }
        break;
      }
      case "tool_progress": {
        const tf = toolByCallId.get(ev.callId);
        if (tf) tf.progress = [...tf.progress, ev.data];
        break;
      }
      case "tool_result": {
        const tf = toolByCallId.get(ev.callId);
        if (tf) {
          tf.output = ev.output;
          tf.error = ev.error;
          tf.durationMs = ev.durationMs;
          tf.pending = false;
        }
        break;
      }
      case "text_delta":
        hasStreamedText = true;
        break;
      case "message":
        // Single non-streamed final message; the parent still owns the
        // text state, no per-event work here.
        break;
      case "a2ui_message":
        break;
      case "done":
        break;
    }
  }
  return { steps, hasStreamedText };
}

function hasA2uiContent(snapshot: A2uiSnapshot): boolean {
  return Object.values(snapshot).some(
    (s) =>
      Object.keys(s.components).length > 0 || (s.ready && !!s.rootId),
  );
}

function stopTone(reason: AgentStopReason | null): "error" | "warn" | null {
  if (!reason || reason === "done") return null;
  if (reason === "budget_exhausted") return "warn";
  return "error";
}

export function Transcript({
  events,
  text,
  a2uiSnapshot,
  liveThought,
  stopReason,
  busy,
  transcriptRendererId,
  toolRendererId,
  a2uiEnabled,
}: Props) {
  const { steps, hasStreamedText } = useMemo(() => build(events), [events]);
  const showA2ui = hasA2uiContent(a2uiSnapshot);
  const a2uiFailed =
    !!a2uiEnabled &&
    stopReason === "done" &&
    !busy &&
    !showA2ui &&
    !text.trim();
  const renderTranscriptContent = resolveTranscriptRenderer(transcriptRendererId);
  const ToolRenderer = resolveToolRenderer(toolRendererId);

  // True while a tool is mid-flight (its card shows "calling…"). Used to
  // decide whether to show the "thinking" indicator: we only show it when
  // the model is working but nothing else is animating — e.g. the gap after
  // the fetches complete and before the answer's first token streams in.
  const anyToolPending = steps.some((s) => s.tools.some((t) => t.pending));
  const hasSettledTool = steps.some((s) => s.tools.some((t) => !t.pending));
  const showThinking = busy && !text && !showA2ui && !anyToolPending;
  const thinkingLabel = hasSettledTool ? "Drafting answer…" : "Thinking…";
  const waitSeconds = useElapsedSeconds(showThinking);

  const tone = stopTone(stopReason);

  const empty = steps.length === 0 && !text && !showA2ui;
  if (empty) {
    return (
      <div className="agentp__empty">
        Run a prompt to see the agent's steps, tool calls, and final answer
        appear here.
      </div>
    );
  }

  return (
    <div className="agentp__transcript">
      {steps.map((step) => {
        // Prefer the finalized thought (from the structural feed); fall
        // back to the live streaming thought while this step is planning.
        const streaming = liveThought?.index === step.index && !step.thought;
        const thought = step.thought ?? (streaming ? liveThought?.text : undefined);
        // Skip content-less turns: a final turn that produced no thought
        // and no tool calls (the common native case) carries no info — its
        // answer renders in the answer block below.
        if (!thought && step.tools.length === 0) return null;
        return (
          // A "turn" groups the model's thinking + the tools it called that
          // turn. No "step N" label (that's an internal loop counter); this
          // reads as an activity trail, à la Claude Code.
          <article key={step.index} className="agentp__turn">
            {thought && (
              // Prose the model emits before calling another tool is just
              // more of the response (often a part of the answer that only
              // lives here, e.g. "Tokyo is 12:31…"). Render it IDENTICALLY
              // to the final answer so the response reads as one consistent
              // thread interleaved with the tool actions, à la Claude Code —
              // no "interim vs final" visual split.
              <div className="agentp__answer-md">
                <TranscriptContent
                  content={thought}
                  streaming={streaming}
                  render={renderTranscriptContent}
                />
              </div>
            )}
            {step.tools.length > 0 && (
              <ul className="agentp__tool-cards">
                {step.tools.map((tool) => (
                  <ToolRenderer key={tool.callId} tool={tool} />
                ))}
              </ul>
            )}
          </article>
        );
      })}

      {showThinking && (
        <div className="agentp__working" aria-live="polite">
          <span className="agentp__working-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {thinkingLabel}
          {waitSeconds > 0 && (
            <span className="agentp__working-timer">{waitSeconds}s</span>
          )}
        </div>
      )}

      {(text || showA2ui || hasStreamedText || stopReason) && (
        <article
          className={`agentp__answer-block${tone ? ` agentp__answer-block--${tone}` : ""}`}
        >
          {stopReason && stopReason !== "done" && (
            <div className="agentp__answer-head">
              <span className="agentp__answer-label">{stopReason}</span>
            </div>
          )}
          <div className="agentp__answer-md">
            {showA2ui ? (
              <A2uiView snapshot={a2uiSnapshot} streaming={busy} />
            ) : text ? (
              <TranscriptContent
                content={text}
                streaming={busy}
                render={renderTranscriptContent}
              />
            ) : a2uiFailed ? (
              <p className="agentp__answer-placeholder">
                The model finished without valid UI JSON (or without a
                renderable surface). Try again, or ask a plain-text question.
                Open the event log in devtools if you need the raw stream.
              </p>
            ) : (
              <p className="agentp__answer-placeholder">
                {stopReason === "aborted"
                  ? "Run was stopped before any answer was produced. The transcript above shows what the agent did before you hit Stop."
                  : "(no answer)"}
              </p>
            )}
          </div>
        </article>
      )}

      {stopReason && stopReason !== "done" && (
        <footer
          className={`agentp__stop${tone ? ` agentp__stop--${tone}` : ""}`}
        >
          stopped: <code>{stopReason}</code>
        </footer>
      )}
    </div>
  );
}

/**
 * Seconds elapsed since `active` last became true; resets to 0 when it
 * turns false. Lets the "Thinking… / Drafting answer…" indicator show how
 * long the current wait has run.
 */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return seconds;
}

function TranscriptContent({
  content,
  streaming,
  render,
}: {
  content: string;
  streaming: boolean;
  render: (props: { content: string; streaming: boolean }) => JSX.Element | null;
}) {
  return render({ content, streaming });
}
