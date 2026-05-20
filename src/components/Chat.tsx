import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Agent, Mode } from "../lib/agents";
import type { ChatMessage } from "../lib/types";
import { MessageContent } from "./MessageContent";
import { ModePicker } from "./ModePicker";

interface Props {
  agent: Agent;
  mode: Mode;
  messages: ChatMessage[];
  status: "idle" | "streaming" | "unavailable";
  error: string | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onClear: () => void;
  onModeChange: (modeId: string) => void;
}

export function Chat({
  agent,
  mode,
  messages,
  status,
  error,
  onSend,
  onAbort,
  onClear,
  onModeChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    setDraft("");
  }, [agent.id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status === "streaming" || status === "unavailable") return;
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  const unavailable = status === "unavailable";
  const streaming = status === "streaming";

  return (
    <section className="chat">
      <header className="chat__header">
        <div className="chat__title-block">
          <div className="chat__title" title={agent.name}>
            {agent.name}
          </div>
          <div className="chat__subtitle">{mode.description}</div>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={onClear}
          disabled={messages.length === 0 && !streaming}
        >
          Clear
        </button>
      </header>

      <div ref={scrollRef} className="chat__messages">
        {messages.length === 0 && !unavailable && (
          <div className="chat__empty">
            Start a conversation. Pick a mode below to set the tone.
          </div>
        )}
        {unavailable && (
          <div className="banner">
            <strong>Prompt API not available.</strong>
            <p>
              This PoC runs on Chrome 138+ or Edge 138+. Enable the flag at{" "}
              <code>chrome://flags/#prompt-api-for-gemini-nano</code> (or{" "}
              <code>edge://flags/#prompt-api-for-phi-mini</code>) and reload.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`msg msg--${m.role}`}>
            <div className="msg__role">
              {m.role === "user" ? "You" : mode.name}
            </div>
            <div className="msg__content">
              <MessageContent content={m.content} streaming={m.streaming} />
            </div>
          </article>
        ))}
        {error && (
          <div className="banner banner--error">
            <strong>Error.</strong>
            <p>{error}</p>
          </div>
        )}
      </div>

      <form className="chat__input" onSubmit={submit}>
        <ModePicker
          mode={mode}
          disabled={streaming || unavailable}
          onChange={onModeChange}
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            unavailable
              ? "Enable the Prompt API to chat…"
              : `Message in ${mode.name} mode…`
          }
          disabled={unavailable}
        />
        {streaming ? (
          <button type="button" className="primary-btn" onClick={onAbort}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="primary-btn"
            disabled={unavailable || !draft.trim()}
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
