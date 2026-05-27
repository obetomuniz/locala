import type { MouseEvent } from "react";
import { findMode, type Chat } from "../lib/chats";

interface Props {
  chats: Chat[];
  activeId: string;
  open: boolean;
  streamingIds: Set<string>;
  activeStreamingId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function Sidebar({
  chats,
  activeId,
  open,
  streamingIds,
  activeStreamingId,
  onSelect,
  onCreate,
  onDelete,
  onClose,
}: Props) {
  const handleDelete = (id: string) => (event: MouseEvent) => {
    event.stopPropagation();
    onDelete(id);
  };

  return (
    <aside className="sidebar" data-open={open ? "true" : "false"}>
      <header className="sidebar__header">
        <div className="sidebar__brand">
          <span className="brand">◆ locala</span>
          <span className="brand-sub">local chats</span>
        </div>
        <button
          type="button"
          className="drawer-close"
          aria-label="Close chats"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <button type="button" className="new-chat-btn" onClick={onCreate}>
        <span className="glyph" aria-hidden="true">
          +
        </span>{" "}
        New chat
      </button>

      <div className="sidebar__section-label">Chats</div>
      <nav className="chat-list">
        {chats.map((chat) => {
          const active = chat.id === activeId;
          const mode = findMode(chat.modeId);
          const count = chat.messages.length;
          return (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              className={`chat-row${active ? " is-active" : ""}`}
              onClick={() => onSelect(chat.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(chat.id);
                }
              }}
            >
              <div className="chat-row__top">
                <span className="chat-row__name" title={chat.name}>
                  {chat.name}
                </span>
                {streamingIds.has(chat.id) &&
                  (chat.id === activeStreamingId ? (
                    <span
                      className="chat-row__streaming"
                      aria-label="streaming"
                      title="streaming"
                    />
                  ) : (
                    <span
                      className="chat-row__queued"
                      aria-label="queued"
                      title="queued (the model finishes one chat at a time)"
                    />
                  ))}
                <button
                  type="button"
                  className="chat-row__delete"
                  aria-label={`Delete ${chat.name}`}
                  onClick={handleDelete(chat.id)}
                >
                  ×
                </button>
              </div>
              <div className="chat-row__meta">
                <span className="mode-pill" title={mode.description}>
                  {mode.name}
                </span>
                <span className="muted">
                  {count === 0
                    ? "empty"
                    : `${count} message${count === 1 ? "" : "s"}`}
                </span>
              </div>
            </div>
          );
        })}
      </nav>

      <footer className="sidebar__footer">
        <span className="muted">{chats.length} chat{chats.length === 1 ? "" : "s"}</span>
      </footer>
    </aside>
  );
}
