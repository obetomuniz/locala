/**
 * `useAgent`: React adapter on top of `AgentStream`.
 *
 * The hook is intentionally a thin projection of the event stream into
 * React state. Each event maps to a state update that React will batch
 * by default. Consumers that need a different projection (e.g. only
 * keep the last 200 events, or compute a custom "trace" type) can call
 * `stream.pipe(...)` themselves and ignore the hook's `events` array.
 *
 * The hook exposes `getStream(input)` for that exact use case: it
 * returns the raw `AgentStream` so the caller can iterate / pipe /
 * await `result` and treat the React state as optional.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAvailable as isPromptAvailable } from "@web-ai-sdk/prompt";
import { createAgent } from "../createAgent";
import type {
  Agent,
  AgentEvent,
  AgentStep,
  AgentStopReason,
  AgentStream,
  AgentTool,
  CreateAgentOptions,
} from "../types";

export type UseAgentStatus =
  | "idle"
  | "planning"
  | "tool_calling"
  | "streaming"
  | "done"
  | "aborted"
  | "error"
  | "unavailable";

export interface UseAgentOptions extends CreateAgentOptions {
  tools?: readonly AgentTool[];
  /**
   * Cap on how many events to keep in `events`. Older events are
   * dropped. Default 500. The full stream is still consumed; this only
   * bounds the React state slice.
   */
  eventLimit?: number;
}

/** The thought currently being streamed, with the step it belongs to. */
export type LiveThought = { index: number; text: string } | null;

export interface UseAgentReturn {
  status: UseAgentStatus;
  text: string;
  /** Streaming thought of the in-flight planning turn (null when idle/none). */
  liveThought: LiveThought;
  steps: AgentStep[];
  events: AgentEvent[];
  stopReason: AgentStopReason | null;
  error: Error | null;
  run: (input: string) => Promise<void>;
  /** Lower-level alternative to `run`: returns the underlying stream. */
  getStream: (input: string) => AgentStream;
  abort: () => void;
  /** Clear the conversation session so the next run starts fresh. */
  newSession: () => void;
  reset: () => void;
}

const EMPTY_EVENTS: AgentEvent[] = [];
const EMPTY_STEPS: AgentStep[] = [];

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const promptAvailable = useMemo(() => isPromptAvailable(), []);
  const eventLimit = options.eventLimit ?? 500;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const agentRef = useRef<Agent | null>(null);

  useEffect(() => {
    agentRef.current = promptAvailable ? createAgent(optionsRef.current) : null;
    return () => {
      agentRef.current?.destroy();
      agentRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options.systemPrompt,
    options.maxSteps,
    options.temperature,
    options.topK,
    options.language,
    options.onToolError,
    options.tools,
    promptAvailable,
  ]);

  const [status, setStatus] = useState<UseAgentStatus>(
    promptAvailable ? "idle" : "unavailable",
  );
  const [text, setText] = useState("");
  // Thought of the in-flight planning turn, streamed token-by-token.
  // Kept separate from `steps`/`events` (like `text`) so the high-freq
  // deltas don't flood the structural feed.
  const [liveThought, setLiveThought] = useState<LiveThought>(null);
  const [steps, setSteps] = useState<AgentStep[]>(EMPTY_STEPS);
  const [events, setEvents] = useState<AgentEvent[]>(EMPTY_EVENTS);
  const [stopReason, setStopReason] = useState<AgentStopReason | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setStatus(promptAvailable ? "idle" : "unavailable");
    setText("");
    setLiveThought(null);
    setSteps(EMPTY_STEPS);
    setEvents(EMPTY_EVENTS);
    setStopReason(null);
    setError(null);
  }, [promptAvailable]);

  const abort = useCallback(() => {
    agentRef.current?.abort();
  }, []);

  // Clear the agent's conversation session AND the UI state, so the next
  // run is a fresh, independent conversation (the on-device model reuses
  // prior answers from session memory otherwise).
  const newSession = useCallback(() => {
    agentRef.current?.newSession();
    setStatus(promptAvailable ? "idle" : "unavailable");
    setText("");
    setSteps(EMPTY_STEPS);
    setEvents(EMPTY_EVENTS);
    setStopReason(null);
    setError(null);
  }, [promptAvailable]);

  const getStream = useCallback((input: string): AgentStream => {
    if (!promptAvailable || !agentRef.current) {
      // Use the unavailable agent's own stream so consumers always get
      // an iterable + a resolved `result` promise.
      return createAgent(optionsRef.current).runStreaming(input);
    }
    return agentRef.current.runStreaming(input);
  }, [promptAvailable]);

  const run = useCallback(
    async (input: string) => {
      if (!promptAvailable) {
        setStatus("unavailable");
        return;
      }
      if (!agentRef.current) return;
      if (runningRef.current) agentRef.current.abort();

      runningRef.current = true;
      setStatus("planning");
      setText("");
      setLiveThought(null);
      setSteps(EMPTY_STEPS);
      setEvents([]);
      setStopReason(null);
      setError(null);

      const eventBuffer: AgentEvent[] = [];
      const stepsByIndex = new Map<number, AgentStep>();

      const stream = agentRef.current.runStreaming(input);

      try {
        for await (const ev of stream) {
          // `plan_delta` and `text_delta` arrive at token frequency
          // (often 50-200 per step). Pushing them through React state
          // produces hundreds of renders that the UI never displays —
          // EventLog already filters both, and `text_delta` is
          // separately accumulated into the `text` state below. Skip
          // them at the projection boundary so the structural event
          // feed stays usable. Advanced consumers who want the raw
          // firehose can iterate `getStream()` directly.
          const isHighFreq =
            ev.type === "plan_delta" ||
            ev.type === "text_delta" ||
            ev.type === "thought_delta";
          if (!isHighFreq) {
            eventBuffer.push(ev);
            const tail =
              eventBuffer.length > eventLimit
                ? eventBuffer.slice(-eventLimit)
                : eventBuffer;
            setEvents([...tail]);
          }

          switch (ev.type) {
            case "step_start":
              stepsByIndex.set(ev.index, {
                index: ev.index,
                plan: {},
                toolCalls: [],
              });
              setStatus("planning");
              setLiveThought(null);
              break;
            case "step_end":
              break;
            case "step_reset":
              // A stalled attempt is being retried — discard the partial
              // thought/answer it streamed so the fresh attempt starts
              // clean instead of appending onto stale text.
              setLiveThought((prev) =>
                prev && prev.index === ev.index ? null : prev,
              );
              setText("");
              break;
            case "plan_delta":
              break;
            case "thought_delta":
              setLiveThought((prev) =>
                prev && prev.index === ev.index
                  ? { index: ev.index, text: prev.text + ev.delta }
                  : { index: ev.index, text: ev.delta },
              );
              break;
            case "thought":
              {
                const step = stepsByIndex.get(ev.index);
                if (step) step.plan = { ...step.plan, thought: ev.text };
                // Final thought is now in the structural feed; the live
                // (streaming) copy for this step is no longer needed.
                setLiveThought((prev) =>
                  prev && prev.index === ev.index ? null : prev,
                );
              }
              break;
            case "plan": {
              const step = stepsByIndex.get(ev.index);
              if (step) step.plan = ev.plan;
              if (!ev.plan.final) setStatus("tool_calling");
              break;
            }
            case "tool_call":
              setStatus("tool_calling");
              break;
            case "tool_progress":
              break;
            case "tool_result": {
              const step = stepsByIndex.get(ev.index);
              if (step) {
                const callEvent = eventBuffer.find(
                  (e): e is Extract<AgentEvent, { type: "tool_call" }> =>
                    e.type === "tool_call" && e.callId === ev.callId,
                );
                step.toolCalls = [
                  ...step.toolCalls,
                  {
                    callId: ev.callId,
                    name: ev.name,
                    input: callEvent?.input ?? {},
                    output: ev.output,
                    error: ev.error,
                    durationMs: ev.durationMs,
                  },
                ];
              }
              break;
            }
            case "text_delta":
              setStatus("streaming");
              setText((prev) => prev + ev.delta);
              break;
            case "message":
              // Authoritative final text. We REPLACE (not "keep if
              // streamed") because the agent may post-process the
              // streamed message — e.g. prepend the "unverified" URL
              // disclaimer — and that version only arrives here. On the
              // normal path this equals the streamed text (no flicker).
              setText(ev.text);
              break;
            case "done":
              setLiveThought(null);
              setSteps(Array.from(stepsByIndex.values()));
              setStopReason(ev.reason);
              setStatus(
                ev.reason === "aborted"
                  ? "aborted"
                  : ev.reason === "done"
                    ? "done"
                    : ev.reason === "unavailable"
                      ? "unavailable"
                      : "error",
              );
              break;
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
      } finally {
        runningRef.current = false;
      }
    },
    [promptAvailable, eventLimit],
  );

  return {
    status,
    text,
    liveThought,
    steps,
    events,
    stopReason,
    error,
    run,
    getStream,
    abort,
    newSession,
    reset,
  };
}
