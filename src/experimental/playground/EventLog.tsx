import { useMemo, useRef } from "react";
import type { AgentEvent } from "../agent/types";
import { useAutoscroll } from "./useAutoscroll";

interface Props {
  events: AgentEvent[];
}

const LABEL: Record<AgentEvent["type"], string> = {
  step_start: "step",
  step_end: "/step",
  step_reset: "retry",
  plan_delta: "Δ",
  thought_delta: "Δ thk",
  thought: "thought",
  plan: "plan",
  tool_call: "call",
  tool_progress: "·",
  tool_result: "result",
  text_delta: "Δ txt",
  message: "msg",
  done: "done",
};

export function EventLog({ events }: Props) {
  // Skip ultra-noisy events (plan_delta, text_delta) by default — the
  // transcript pane is the streaming view; this pane is for structure.
  const compact = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.type !== "plan_delta" &&
            e.type !== "text_delta" &&
            e.type !== "thought_delta",
        )
        .map((e, i) => ({ ...e, _i: i })),
    [events],
  );

  const listRef = useRef<HTMLOListElement>(null);
  useAutoscroll(listRef, [compact.length]);

  if (compact.length === 0) {
    return (
      <div className="agentp__empty">
        Step boundaries, plans, tool calls, and progress show up here as
        the agent works.
      </div>
    );
  }

  return (
    <ol ref={listRef} className="agentp__log">
      {compact.map((ev) => {
        const key = `${ev._i}-${ev.type}`;
        return (
          <li key={key} className={`agentp__log-item agentp__log-item--${ev.type}`}>
            <span className="agentp__log-kind">{LABEL[ev.type]}</span>
            <span className="agentp__log-body">{renderBody(ev)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function renderBody(ev: AgentEvent): string {
  switch (ev.type) {
    case "step_start":
    case "step_end":
    case "step_reset":
      return `#${ev.index + 1}`;
    case "thought":
      return truncate(ev.text);
    case "plan":
      if (ev.plan.final) {
        return `final · ${truncate(ev.plan.message ?? "")}`;
      }
      return `${(ev.plan.toolCalls ?? []).map((c) => c.name).join(", ") || "(no calls)"}${
        ev.plan.thought ? ` · ${truncate(ev.plan.thought)}` : ""
      }`;
    case "tool_call":
      return `${ev.name}(${truncate(JSON.stringify(ev.input))})`;
    case "tool_progress":
      return `${ev.name} · ${truncate(JSON.stringify(ev.data))}`;
    case "tool_result":
      if (ev.error) return `${ev.name} → error: ${truncate(ev.error.message)}`;
      return `${ev.name} → ${truncate(JSON.stringify(ev.output))} (${Math.round(ev.durationMs)}ms)`;
    case "message":
      return truncate(ev.text);
    case "done":
      return `${ev.reason} · ${ev.text ? truncate(ev.text) : "(empty)"}`;
    default:
      return "";
  }
}

function truncate(s: string, n = 120): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
