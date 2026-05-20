import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  isPromptAvailable,
  PromptUnavailableError,
  type Session,
} from "@web-ai-sdk/prompt";
import {
  type Agent,
  type Mode,
  DEFAULT_AGENT_NAME,
  deriveAgentName,
} from "./agents";
import { generateTitle } from "./title";
import type { AgentOps } from "./useAgents";
import type { ActivityEvent, ChatMessage } from "./types";

export type ChatStatus = "idle" | "streaming" | "unavailable";

interface UseChatArgs {
  agent: Agent;
  mode: Mode;
  ops: AgentOps;
  onActivity: (event: Omit<ActivityEvent, "id" | "ts">) => void;
}

interface ActiveStream {
  session: Session;
  messageId: string;
  modeName: string;
  // Becomes true once the first delta arrives. Under Chrome's FIFO scheduling
  // only one in-flight stream can be past first-delta at a time; the others
  // are "queued" (waiting for the active inference to finish).
  firstDeltaSeen: boolean;
}

interface CachedSession {
  session: Session;
  modeId: string;
}

// Seed createOptions.initialPrompts from the agent's persisted messages so a
// reload (or a mode change) doesn't leave the model with amnesia while the UI
// still shows the prior turns. Subsequent session.sendStreaming() only sends
// the new user message; the native instance tracks history from there.
function seedInitialPrompts(
  agent: Agent,
  mode: Mode,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const seed: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];
  if (mode.systemPrompt) {
    seed.push({ role: "system", content: mode.systemPrompt });
  }
  for (const message of agent.messages) {
    if (message.streaming || !message.content) continue;
    seed.push({ role: message.role, content: message.content });
  }
  return seed;
}

export function useChat({ agent, mode, ops, onActivity }: UseChatArgs) {
  const sessionsRef = useRef<Map<string, CachedSession>>(new Map());
  const activeStreamsRef = useRef<Map<string, ActiveStream>>(new Map());
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [activeStreamingId, setActiveStreamingId] = useState<string | null>(
    null,
  );
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const promptAvailable = useMemo(() => isPromptAvailable(), []);

  const ctxRef = useRef({ ops, onActivity });
  ctxRef.current = { ops, onActivity };

  useEffect(() => {
    return () => {
      for (const stream of activeStreamsRef.current.values()) {
        stream.session.abort();
      }
      activeStreamsRef.current.clear();
      for (const cached of sessionsRef.current.values()) {
        cached.session.destroy();
      }
      sessionsRef.current.clear();
    };
  }, []);

  const refreshStreamingIds = useCallback(() => {
    setStreamingIds(new Set(activeStreamsRef.current.keys()));
  }, []);

  const acquireSession = useCallback((a: Agent, m: Mode): Session => {
    const existing = sessionsRef.current.get(a.id);
    if (existing && existing.modeId === m.id) return existing.session;
    if (existing) existing.session.destroy();

    const initialPrompts = seedInitialPrompts(a, m);
    const session = createSession({
      temperature: m.temperature,
      topK: m.topK,
      createOptions:
        initialPrompts.length > 0 ? { initialPrompts } : undefined,
      // systemPrompt is folded into initialPrompts above when there is
      // history; pass it directly only when seeding is empty so the
      // SDK doesn't warn about double-seeding it.
      ...(initialPrompts.length === 0 && m.systemPrompt
        ? { systemPrompt: m.systemPrompt }
        : {}),
    });
    sessionsRef.current.set(a.id, { session, modeId: m.id });
    return session;
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!promptAvailable) return;
      if (activeStreamsRef.current.has(agent.id)) return;

      const a = agent;
      const m = mode;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        agentId: a.id,
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        agentId: a.id,
        streaming: true,
      };

      ctxRef.current.ops.appendMessages(a.id, [userMsg, assistantMsg]);

      if (a.messages.length === 0 && a.name === DEFAULT_AGENT_NAME) {
        const initialName = deriveAgentName(trimmed);
        ctxRef.current.ops.rename(a.id, initialName);
        void generateTitle(trimmed).then((title) => {
          if (!title || title === initialName) return;
          ctxRef.current.ops.rename(a.id, title);
          ctxRef.current.onActivity({
            kind: "info",
            message: "title summarized",
            detail: `[${a.name}] ${title}`,
          });
        });
      }

      let session: Session;
      try {
        session = acquireSession(a, m);
      } catch (err) {
        const message =
          err instanceof PromptUnavailableError
            ? err.message
            : ((err as Error)?.message ?? String(err));
        ctxRef.current.ops.updateMessage(a.id, assistantId, {
          streaming: false,
        });
        setErrors((prev) => new Map(prev).set(a.id, message));
        return;
      }

      activeStreamsRef.current.set(a.id, {
        session,
        messageId: assistantId,
        modeName: m.name,
        firstDeltaSeen: false,
      });
      refreshStreamingIds();
      setErrors((prev) => {
        if (!prev.has(a.id)) return prev;
        const next = new Map(prev);
        next.delete(a.id);
        return next;
      });

      ctxRef.current.onActivity({
        kind: "chat_send",
        message: `→ ${m.name}`,
        detail: `[${a.name}] ${trimmed}`,
      });

      let buffer = "";
      try {
        for await (const delta of session.sendStreaming(trimmed)) {
          // The first delta is the signal that this chat moved from queued
          // to actively receiving tokens. Chrome's LanguageModel is FIFO
          // across instances, so only one chat is past first-delta at a time.
          const stream = activeStreamsRef.current.get(a.id);
          if (stream && !stream.firstDeltaSeen) {
            stream.firstDeltaSeen = true;
            setActiveStreamingId(a.id);
          }
          buffer += delta;
          ctxRef.current.ops.updateMessage(a.id, assistantId, {
            content: buffer,
          });
        }
        ctxRef.current.ops.updateMessage(a.id, assistantId, {
          content: buffer,
          streaming: false,
        });
        ctxRef.current.onActivity({
          kind: "chat_response",
          message: `← ${m.name}`,
          detail: `[${a.name}] ${buffer || "(empty)"}`,
        });
      } catch (err) {
        const e = err as Error;
        if (e?.name === "AbortError") {
          ctxRef.current.ops.updateMessage(a.id, assistantId, {
            content: buffer,
            streaming: false,
          });
          ctxRef.current.onActivity({
            kind: "chat_abort",
            message: "aborted",
            detail: `[${a.name}]`,
          });
        } else {
          ctxRef.current.ops.updateMessage(a.id, assistantId, {
            content: buffer,
            streaming: false,
          });
          // Broken session can leave native history desynced — drop it so
          // the next send seeds a fresh one from agent.messages.
          const cached = sessionsRef.current.get(a.id);
          if (cached?.session === session) {
            cached.session.destroy();
            sessionsRef.current.delete(a.id);
          }
          const message =
            e instanceof PromptUnavailableError
              ? e.message
              : (e?.message ?? String(e));
          setErrors((prev) => new Map(prev).set(a.id, message));
          ctxRef.current.onActivity({
            kind: "info",
            message: "error",
            detail: `[${a.name}] ${message}`,
          });
        }
      } finally {
        activeStreamsRef.current.delete(a.id);
        refreshStreamingIds();
        // If this was the actively-streaming chat, clear it. The next FIFO
        // turn will set itself active when its first delta arrives.
        setActiveStreamingId((current) => (current === a.id ? null : current));
      }
    },
    [agent, mode, promptAvailable, acquireSession, refreshStreamingIds],
  );

  const abort = useCallback(() => {
    const stream = activeStreamsRef.current.get(agent.id);
    if (stream) stream.session.abort();
  }, [agent.id]);

  const clear = useCallback(() => {
    const stream = activeStreamsRef.current.get(agent.id);
    if (stream) stream.session.abort();
    const cached = sessionsRef.current.get(agent.id);
    if (cached) {
      cached.session.destroy();
      sessionsRef.current.delete(agent.id);
    }
    ctxRef.current.ops.clearMessages(agent.id);
    setErrors((prev) => {
      if (!prev.has(agent.id)) return prev;
      const next = new Map(prev);
      next.delete(agent.id);
      return next;
    });
    ctxRef.current.onActivity({
      kind: "chat_clear",
      message: "chat cleared",
      detail: `[${agent.name}]`,
    });
  }, [agent.id, agent.name]);

  const status: ChatStatus = !promptAvailable
    ? "unavailable"
    : streamingIds.has(agent.id)
      ? "streaming"
      : "idle";

  return {
    status,
    error: errors.get(agent.id) ?? null,
    send,
    abort,
    clear,
    streamingAgentIds: streamingIds,
    activeStreamingAgentId: activeStreamingId,
  };
}
