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

import { useMemo } from "react";
import { MessageContent } from "../../components/MessageContent";
import type { AgentEvent, AgentStopReason } from "../agent/types";

interface Props {
  events: AgentEvent[];
  text: string;
  /** Thought of the in-flight planning turn, streamed token-by-token. */
  liveThought: { index: number; text: string } | null;
  stopReason: AgentStopReason | null;
  busy: boolean;
}

interface ToolFrame {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  progress: unknown[];
  output?: unknown;
  error?: { message: string; name?: string };
  durationMs?: number;
  pending: boolean;
}

interface StepFrame {
  index: number;
  thought?: string;
  tools: ToolFrame[];
  isFinal: boolean;
}

interface BuiltTranscript {
  steps: StepFrame[];
  hasStreamedText: boolean;
}

function build(events: AgentEvent[]): BuiltTranscript {
  const steps: StepFrame[] = [];
  let current: StepFrame | null = null;
  let toolByCallId = new Map<string, ToolFrame>();
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
          const tf: ToolFrame = {
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
      case "done":
        break;
    }
  }
  return { steps, hasStreamedText };
}

export function Transcript({ events, text, liveThought, stopReason, busy }: Props) {
  const { steps, hasStreamedText } = useMemo(() => build(events), [events]);

  // True while a tool is mid-flight (its card shows "calling…"). Used to
  // decide whether to show the "thinking" indicator: we only show it when
  // the model is working but nothing else is animating — e.g. the gap after
  // the fetches complete and before the answer's first token streams in.
  const anyToolPending = steps.some((s) => s.tools.some((t) => t.pending));
  const showThinking = busy && !text && !anyToolPending;

  const empty = steps.length === 0 && !text;
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
                <MessageContent content={thought} streaming={streaming} />
              </div>
            )}
            {step.tools.length > 0 && (
              <ul className="agentp__tool-cards">
                {step.tools.map((tool) => (
                  <ToolCard key={tool.callId} tool={tool} />
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
          Thinking…
        </div>
      )}

      {(text || hasStreamedText || stopReason) && (
        <article className="agentp__answer-block">
          {stopReason && stopReason !== "done" && (
            <div className="agentp__answer-head">
              <span className="agentp__answer-label">{stopReason}</span>
            </div>
          )}
          <div className="agentp__answer-md">
            {text ? (
              <MessageContent content={text} streaming={busy} />
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
        <footer className="agentp__stop">
          stopped: <code>{stopReason}</code>
        </footer>
      )}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolFrame }) {
  const status = tool.pending ? "calling" : tool.error ? "error" : "ok";

  return (
    <li className={`agentp__tool-card agentp__tool-card--${status}`}>
      <header className="agentp__tool-card-head">
        <code className="agentp__tool-card-name">{tool.name}</code>
        <span
          className={`agentp__tool-card-status agentp__tool-card-status--${status}`}
        >
          {status === "calling" && "calling…"}
          {status === "ok" && `${Math.round(tool.durationMs ?? 0)}ms`}
          {status === "error" && "error"}
        </span>
      </header>

      {tool.progress.length > 0 && (
        <ul className="agentp__tool-progress">
          {tool.progress.map((p, i) => (
            <li key={i} className="agentp__tool-progress-item">
              <span className="agentp__tool-progress-dot" />
              <code>{summarizeJson(p)}</code>
            </li>
          ))}
        </ul>
      )}

      <details className="agentp__tool-card-details">
        <summary className="agentp__tool-card-summary">
          input · {summarizeJson(tool.input)}
        </summary>
        <pre className="agentp__tool-card-json">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      </details>
      {!tool.pending && (
        <details className="agentp__tool-card-details" open={!!tool.error}>
          <summary className="agentp__tool-card-summary">
            {tool.error
              ? `error · ${truncate(tool.error.message, 80)}`
              : `output · ${summarizeJson(tool.output)}`}
          </summary>
          <pre className="agentp__tool-card-json">
            {tool.error
              ? formatError(tool.error)
              : JSON.stringify(tool.output, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function summarizeJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return `"${truncate(value, 40)}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), 60);
  } catch {
    return "[unserializable]";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function formatError(err: { message: string; name?: string }): string {
  if (err.name) return `${err.name}: ${err.message}`;
  return err.message;
}
