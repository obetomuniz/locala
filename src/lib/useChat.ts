import { useCallback, useEffect, useRef } from "react";
import { usePrompt, type PromptStatus } from "@web-ai-sdk/prompt/react";
import {
  type Agent,
  type Mode,
  DEFAULT_AGENT_NAME,
  deriveAgentName,
} from "./agents";
import type { AgentOps } from "./useAgents";
import type { ActivityEvent, ChatMessage } from "./types";

export type ChatStatus = "idle" | "streaming" | "unavailable";

interface UseChatArgs {
  agent: Agent;
  mode: Mode;
  ops: AgentOps;
  onActivity: (event: Omit<ActivityEvent, "id" | "ts">) => void;
}

const mapStatus = (s: PromptStatus): ChatStatus => {
  switch (s) {
    case "loading":
    case "streaming":
      return "streaming";
    case "unavailable":
      return "unavailable";
    default:
      return "idle";
  }
};

export function useChat({ agent, mode, ops, onActivity }: UseChatArgs) {
  const streamingIdRef = useRef<string | null>(null);
  const ctxRef = useRef({ agent, mode, ops, onActivity });
  ctxRef.current = { agent, mode, ops, onActivity };

  const {
    status: promptStatus,
    response,
    error: promptError,
    ask,
    abort: abortPrompt,
    reset,
  } = usePrompt({
    systemPrompt: mode.systemPrompt,
    temperature: mode.temperature,
    topK: mode.topK,
  });

  useEffect(() => {
    streamingIdRef.current = null;
    reset();
  }, [agent.id, reset]);

  useEffect(() => {
    const id = streamingIdRef.current;
    if (!id) return;
    const { agent: a, ops: o, mode: m, onActivity: notify } = ctxRef.current;

    if (promptStatus === "streaming" || promptStatus === "loading") {
      if (response !== null) {
        o.updateMessage(a.id, id, { content: response });
      }
      return;
    }
    if (promptStatus === "done" || promptStatus === "idle") {
      o.updateMessage(a.id, id, {
        content: response ?? "",
        streaming: false,
      });
      streamingIdRef.current = null;
      notify(
        promptStatus === "done"
          ? {
              kind: "chat_response",
              message: `← ${m.name}`,
              detail: response ?? "(empty response)",
            }
          : { kind: "chat_abort", message: "aborted" },
      );
    }
  }, [promptStatus, response]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (
        promptStatus === "loading" ||
        promptStatus === "streaming" ||
        promptStatus === "unavailable"
      ) {
        return;
      }

      const { agent: a, mode: m, ops: o, onActivity: notify } = ctxRef.current;

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

      const transcript = [...a.messages, userMsg]
        .map(
          (msg) =>
            `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
        )
        .join("\n");

      o.appendMessages(a.id, [userMsg, assistantMsg]);
      streamingIdRef.current = assistantId;

      if (a.messages.length === 0 && a.name === DEFAULT_AGENT_NAME) {
        o.rename(a.id, deriveAgentName(trimmed));
      }

      notify({
        kind: "chat_send",
        message: `→ ${m.name}`,
        detail: trimmed,
      });

      await ask(`${transcript}\nAssistant:`);
    },
    [ask, promptStatus],
  );

  const abort = useCallback(() => {
    abortPrompt();
  }, [abortPrompt]);

  const clear = useCallback(() => {
    abortPrompt();
    const { agent: a, ops: o, onActivity: notify } = ctxRef.current;
    streamingIdRef.current = null;
    o.clearMessages(a.id);
    reset();
    notify({ kind: "chat_clear", message: "chat cleared" });
  }, [abortPrompt, reset]);

  return {
    status: mapStatus(promptStatus),
    error: promptError?.message ?? null,
    send,
    abort,
    clear,
  };
}
