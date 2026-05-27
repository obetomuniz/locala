import { useCallback, useEffect, useMemo, useState } from "react";
import { isAvailable as isPromptAvailable } from "@web-ai-sdk/prompt";
import { isAvailable as isSummarizerAvailable } from "@web-ai-sdk/summarizer";
import { Sidebar } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { Workspace } from "./components/Workspace";
import { useChats } from "./lib/useChats";
import { useChat } from "./lib/useChat";
import { useWebMCPTools } from "./lib/useWebMCPTools";
import { findMode } from "./lib/chats";
import type { ActivityEvent } from "./lib/types";

const MAX_ACTIVITY = 50;

export function App() {
  const { chats, activeChat, activeMode, ops } = useChats();
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
      if (id === activeChat.id) return;
      ops.select(id);
      const next = chats.find((c) => c.id === id);
      pushActivity({
        kind: "chat_switch",
        message: `→ ${next?.name ?? id}`,
      });
    },
    [activeChat.id, chats, ops, pushActivity],
  );

  const handleCreate = useCallback(() => {
    setSidebarOpen(false);
    const chat = ops.create(activeChat.modeId);
    pushActivity({
      kind: "chat_switch",
      message: `+ ${chat.name}`,
      detail: findMode(chat.modeId).name,
    });
  }, [ops, activeChat.modeId, pushActivity]);

  const handleDelete = useCallback(
    (id: string) => {
      const target = chats.find((c) => c.id === id);
      ops.remove(id);
      pushActivity({
        kind: "info",
        message: "deleted",
        detail: target?.name,
      });
    },
    [chats, ops, pushActivity],
  );

  const handleModeChange = useCallback(
    (modeId: string) => {
      ops.setMode(activeChat.id, modeId);
      pushActivity({
        kind: "info",
        message: "mode",
        detail: findMode(modeId).name,
      });
    },
    [activeChat.id, ops, pushActivity],
  );

  const {
    status,
    error,
    send,
    abort,
    clear,
    streamingChatIds,
    activeStreamingChatId,
  } = useChat({
    chat: activeChat,
    mode: activeMode,
    ops,
    onActivity: pushActivity,
  });

  const { available: webmcpAvailable } = useWebMCPTools({
    chats,
    activeChat,
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
          aria-label="Open chats"
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
          <span className="topbar__name" title={activeChat.name}>
            {activeChat.name}
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
        chats={chats}
        activeId={activeChat.id}
        open={sidebarOpen}
        streamingIds={streamingChatIds}
        activeStreamingId={activeStreamingChatId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onClose={() => setSidebarOpen(false)}
      />
      <Chat
        chat={activeChat}
        mode={activeMode}
        messages={activeChat.messages}
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
        chatCount={chats.length}
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
