import type { ActivityEvent } from "../lib/types";

interface Props {
  events: ActivityEvent[];
  webmcpAvailable: boolean;
  promptAvailable: boolean;
  chatCount: number;
  open: boolean;
  onClose: () => void;
}

const KIND_LABELS: Record<ActivityEvent["kind"], string> = {
  chat_send: "send",
  chat_response: "response",
  chat_abort: "abort",
  chat_clear: "clear",
  agent_switch: "agent",
  tool_invoked: "tool",
  info: "info",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Workspace({
  events,
  webmcpAvailable,
  promptAvailable,
  chatCount,
  open,
  onClose,
}: Props) {
  return (
    <section className="workspace" data-open={open ? "true" : "false"}>
      <header className="workspace__header">
        <div className="workspace__title">
          Workspace
          <span className="muted workspace__count">
            · {chatCount} chat{chatCount === 1 ? "" : "s"}
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
          <div className="pane__title">Activity</div>
          {events.length === 0 ? (
            <div className="pane__empty">
              Activity from the chat and any WebMCP tool calls shows up here.
            </div>
          ) : (
            <ul className="activity">
              {events.map((e) => (
                <li key={e.id} className={`activity__item activity__item--${e.kind}`}>
                  <span className="activity__time">{fmtTime(e.ts)}</span>
                  <span className="activity__kind">{KIND_LABELS[e.kind]}</span>
                  <span className="activity__message">{e.message}</span>
                  {e.detail && (
                    <span className="activity__detail">{e.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="workspace__pane">
          <div className="pane__title">Hints</div>
          <ul className="hints">
            <li>
              External agents (Chrome agent / Cursor / Claude) can drive this
              app via WebMCP. Try: <code>list_modes</code>,{" "}
              <code>list_chats</code>, <code>new_chat</code>,{" "}
              <code>switch_chat</code>, <code>set_mode</code>,{" "}
              <code>send_message</code>, <code>clear_chat</code>,{" "}
              <code>delete_chat</code>.
            </li>
            <li>
              Conversation history is concatenated into each prompt so the
              warm session is reused (system prompt + sampling stay stable per
              agent).
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
