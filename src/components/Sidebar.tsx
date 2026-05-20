import type { MouseEvent } from "react";
import { findMode, type Agent } from "../lib/agents";

interface Props {
  agents: Agent[];
  activeId: string;
  open: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function Sidebar({
  agents,
  activeId,
  open,
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
          <span className="brand-sub">local agents</span>
        </div>
        <button
          type="button"
          className="drawer-close"
          aria-label="Close agents"
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

      <div className="sidebar__section-label">Agents</div>
      <nav className="agent-list">
        {agents.map((agent) => {
          const active = agent.id === activeId;
          const mode = findMode(agent.modeId);
          const count = agent.messages.length;
          return (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              className={`agent-row${active ? " is-active" : ""}`}
              onClick={() => onSelect(agent.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(agent.id);
                }
              }}
            >
              <div className="agent-row__top">
                <span className="agent-row__name" title={agent.name}>
                  {agent.name}
                </span>
                <button
                  type="button"
                  className="agent-row__delete"
                  aria-label={`Delete ${agent.name}`}
                  onClick={handleDelete(agent.id)}
                >
                  ×
                </button>
              </div>
              <div className="agent-row__meta">
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
        <span className="muted">{agents.length} agent{agents.length === 1 ? "" : "s"}</span>
      </footer>
    </aside>
  );
}
