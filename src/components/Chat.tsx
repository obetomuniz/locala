import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Chat as ChatModel, Mode } from "../lib/chats";
import type { ChatMessage } from "../lib/types";
import { MessageContent } from "./MessageContent";
import { ModeMenu } from "./ModeMenu";

export type ChatStatus = "idle" | "streaming" | "unavailable";

interface Props {
  chat: ChatModel;
  mode: Mode;
  messages: ChatMessage[];
  status: ChatStatus;
  error: string | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onModeChange: (modeId: string) => void;
}

export function Chat({
  chat,
  mode,
  messages,
  status,
  error,
  onSend,
  onAbort,
  onModeChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    setDraft("");
  }, [chat.id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status !== "idle") return;
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  const unavailable = status === "unavailable";
  const streaming = status === "streaming";

  const placeholder = unavailable
    ? "Enable the Prompt API to chat…"
    : `Message in ${mode.name} mode…`;

  return (
    <section className="chat">
      <header className="chat__header">
        <div className="chat__title-block">
          <div className="chat__title" title={chat.name}>
            {chat.name}
          </div>
          <div className="chat__subtitle">{mode.description}</div>
        </div>
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
        <div className="composer" data-disabled={unavailable ? "true" : "false"}>
          <ModeMenu
            mode={mode}
            disabled={streaming || unavailable}
            onChange={onModeChange}
          />
          <input
            className="composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={unavailable}
          />
          {streaming ? (
            <button
              type="button"
              className="primary-btn composer__send"
              onClick={onAbort}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="primary-btn composer__send"
              disabled={unavailable || !draft.trim()}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
