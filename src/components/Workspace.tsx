import type { ActivityEvent } from "../lib/types";

interface Props {
  events: ActivityEvent[];
  webmcpAvailable: boolean;
  promptAvailable: boolean;
  summarizerAvailable: boolean;
  chatCount: number;
  open: boolean;
  onClose: () => void;
  onClearActivity: () => void;
}

const KIND_LABELS: Record<ActivityEvent["kind"], string> = {
  chat_send: "send",
  chat_response: "reply",
  chat_abort: "abort",
  chat_clear: "clear",
  chat_switch: "chat",
  tool_invoked: "tool",
  info: "info",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function Workspace({
  events,
  webmcpAvailable,
  promptAvailable,
  summarizerAvailable,
  chatCount,
  open,
  onClose,
  onClearActivity,
}: Props) {
  return (
    <section className="workspace" data-open={open ? "true" : "false"}>
      <header className="workspace__header">
        <div className="workspace__title">
          Workspace
          <span className="muted workspace__count">
            · {chatCount} thread{chatCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="workspace__chips">
          <span
            className={`chip${promptAvailable ? " chip--ok" : " chip--off"}`}
            title="@web-ai-sdk/prompt"
          >
            prompt {promptAvailable ? "on" : "off"}
          </span>
          <span
            className={`chip${webmcpAvailable ? " chip--ok" : " chip--off"}`}
            title="@web-ai-sdk/webmcp"
          >
            webmcp {webmcpAvailable ? "on" : "off"}
          </span>
          <span
            className={`chip${summarizerAvailable ? " chip--ok" : " chip--off"}`}
            title="@web-ai-sdk/summarizer (chat titles)"
          >
            sum {summarizerAvailable ? "on" : "off"}
          </span>
        </div>
        <button
          type="button"
          className="drawer-close"
          aria-label="Close workspace"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="workspace__body">
        <div className="workspace__pane">
          <div className="pane__title">
            <span>Activity</span>
            <button
              type="button"
              className="pane__action"
              onClick={onClearActivity}
              disabled={events.length === 0}
              aria-label="Clear activity"
            >
              Clear
            </button>
          </div>
          {events.length === 0 ? (
            <div className="pane__empty">
              Activity from the agent and any WebMCP tool calls shows up here.
            </div>
          ) : (
            <ul className="activity">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={`activity__item activity__item--${e.kind}`}
                  title={e.detail ? `${e.message} · ${e.detail}` : e.message}
                >
                  <span className="activity__time">{fmtTime(e.ts)}</span>
                  <span className="activity__kind">{KIND_LABELS[e.kind]}</span>
                  <span className="activity__main">
                    <span className="activity__message">{e.message}</span>
                    {e.detail && (
                      <span className="activity__detail">{e.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="workspace__pane">
          <div className="pane__title">Skills</div>
          <ul className="hints">
            <li>
              <div className="muted experimental-link__detail">
                Locala now opens directly into an on-device agent built on top of{" "}
                <a
                  href="https://web-ai-sdk.dev/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  web-ai-sdk.dev
                </a>
                . Skills bundle prompts, tools, examples, and renderers.
              </div>
            </li>
          </ul>
        </div>

        <div className="workspace__pane">
          <div className="pane__title">Hints</div>
          <ul className="hints">
            <li>
              External agents (Chrome agent / Cursor / Claude) can drive this
              app via WebMCP. Try: <code>list_skills</code>,{" "}
              <code>list_threads</code>, <code>new_thread</code>,{" "}
              <code>switch_thread</code>, <code>set_skill</code>,{" "}
              <code>send_message</code>, <code>clear_thread</code>,{" "}
              <code>delete_thread</code>.
            </li>
            <li>
              Each active thread reuses a Prompt API session in thread mode.
              Visible turns persist in <code>locala:v3:agent-threads</code>.
            </li>
            <li>
              Threads look parallel but the model is single-instance on the
              device. Chrome 138+ schedules overlapping{" "}
              <code>sendStreaming</code> calls FIFO: the active thread finishes
              its tokens before the next one starts. The sidebar shows a
              hollow dot for work waiting in line.
            </li>
            <li>
              All inference runs on-device via{" "}
              <code>navigator.LanguageModel</code>. Nothing leaves the browser.
            </li>
            <li>
              Built-in browser models have a training cutoff and no internet
              access. Answers about recent events, library versions, or rapidly
              changing facts may be out of date. Verify before relying on them.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
