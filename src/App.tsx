import { useCallback, useEffect, useMemo, useState } from "react";
import { isPromptAvailable } from "@web-ai-sdk/prompt";
import { isSummarizerAvailable } from "@web-ai-sdk/summarizer";
import { Sidebar } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { Workspace } from "./components/Workspace";
import { useAgents } from "./lib/useAgents";
import { useChat } from "./lib/useChat";
import { useWebMCPTools } from "./lib/useWebMCPTools";
import { findMode } from "./lib/agents";
import type { ActivityEvent } from "./lib/types";

const MAX_ACTIVITY = 50;

export function App() {
  const { agents, activeAgent, activeMode, ops } = useAgents();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const promptAvailable = useMemo(() => isPromptAvailable(), []);
  const summarizerAvailable = useMemo(() => isSummarizerAvailable(), []);

  const closeDrawers = useCallback(() => {
    setSidebarOpen(false);
    setWorkspaceOpen(false);
  }, []);

  useEffect(() => {
    if (!sidebarOpen && !workspaceOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawers();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sidebarOpen, workspaceOpen, closeDrawers]);

  const pushActivity = useCallback(
    (event: Omit<ActivityEvent, "id" | "ts">) => {
      setEvents((prev) =>
        [
          { id: crypto.randomUUID(), ts: Date.now(), ...event },
          ...prev,
        ].slice(0, MAX_ACTIVITY),
      );
    },
    [],
  );

  const clearActivity = useCallback(() => {
    setEvents([]);
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      setSidebarOpen(false);
      if (id === activeAgent.id) return;
      ops.select(id);
      const next = agents.find((a) => a.id === id);
      pushActivity({
        kind: "agent_switch",
        message: `→ ${next?.name ?? id}`,
      });
    },
    [activeAgent.id, agents, ops, pushActivity],
  );

  const handleCreate = useCallback(() => {
    setSidebarOpen(false);
    const agent = ops.create(activeAgent.modeId);
    pushActivity({
      kind: "agent_switch",
      message: `+ ${agent.name}`,
      detail: findMode(agent.modeId).name,
    });
  }, [ops, activeAgent.modeId, pushActivity]);

  const handleDelete = useCallback(
    (id: string) => {
      const target = agents.find((a) => a.id === id);
      ops.remove(id);
      pushActivity({
        kind: "info",
        message: "deleted",
        detail: target?.name,
      });
    },
    [agents, ops, pushActivity],
  );

  const handleModeChange = useCallback(
    (modeId: string) => {
      ops.setMode(activeAgent.id, modeId);
      pushActivity({
        kind: "info",
        message: "mode",
        detail: findMode(modeId).name,
      });
    },
    [activeAgent.id, ops, pushActivity],
  );

  const {
    status,
    error,
    send,
    abort,
    clear,
    streamingAgentIds,
    activeStreamingAgentId,
  } = useChat({
    agent: activeAgent,
    mode: activeMode,
    ops,
    onActivity: pushActivity,
  });

  const { available: webmcpAvailable } = useWebMCPTools({
    agents,
    activeAgent,
    ops,
    send,
    clear,
    pushActivity,
  });

  useEffect(() => {
    pushActivity({
      kind: "info",
      message: "ready",
      detail: `prompt:${promptAvailable ? "on" : "off"} · webmcp:${webmcpAvailable ? "on" : "off"} · summarizer:${summarizerAvailable ? "on" : "off"}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveStatus = !promptAvailable ? "unavailable" : status;
  const anyDrawerOpen = sidebarOpen || workspaceOpen;

  return (
    <div className="app" data-drawer={anyDrawerOpen ? "true" : "false"}>
      <header className="topbar">
        <button
          type="button"
          className="topbar__btn"
          aria-label="Open agents"
          aria-expanded={sidebarOpen}
          onClick={() => {
            setWorkspaceOpen(false);
            setSidebarOpen((v) => !v);
          }}
        >
          <span className="topbar__icon topbar__icon--menu" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="topbar__title">
          <span className="topbar__name" title={activeAgent.name}>
            {activeAgent.name}
          </span>
          <span className="topbar__mode">{activeMode.name}</span>
        </div>
        <button
          type="button"
          className="topbar__btn"
          aria-label="Open workspace"
          aria-expanded={workspaceOpen}
          onClick={() => {
            setSidebarOpen(false);
            setWorkspaceOpen((v) => !v);
          }}
        >
          <span className="topbar__icon topbar__icon--dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      </header>

      <Sidebar
        agents={agents}
        activeId={activeAgent.id}
        open={sidebarOpen}
        streamingIds={streamingAgentIds}
        activeStreamingId={activeStreamingAgentId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onClose={() => setSidebarOpen(false)}
      />
      <Chat
        agent={activeAgent}
        mode={activeMode}
        messages={activeAgent.messages}
        status={effectiveStatus}
        error={error}
        onSend={send}
        onAbort={abort}
        onModeChange={handleModeChange}
      />
      <Workspace
        events={events}
        promptAvailable={promptAvailable}
        webmcpAvailable={webmcpAvailable}
        summarizerAvailable={summarizerAvailable}
        chatCount={agents.length}
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        onClearActivity={clearActivity}
      />

      <button
        type="button"
        className="backdrop"
        aria-hidden={!anyDrawerOpen}
        tabIndex={-1}
        onClick={closeDrawers}
      />
    </div>
  );
}
