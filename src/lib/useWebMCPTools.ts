import { useEffect, useMemo, useRef } from "react";
import { isWebMCPAvailable } from "@web-ai-sdk/webmcp";
import { useWebMCP, type Tool } from "@web-ai-sdk/webmcp/react";
import { MODES, findMode, type Agent } from "./agents";
import type { AgentOps } from "./useAgents";
import type { ActivityEvent } from "./types";

interface Args {
  agents: Agent[];
  activeAgent: Agent;
  ops: AgentOps;
  send: (text: string) => Promise<void> | void;
  clear: () => void;
  pushActivity: (event: Omit<ActivityEvent, "id" | "ts">) => void;
}

export function useWebMCPTools(args: Args) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const available = isWebMCPAvailable();

  const tools = useMemo<Tool[]>(() => {
    const report = (name: string, detail?: string) => {
      argsRef.current.pushActivity({
        kind: "tool_invoked",
        message: name,
        detail,
      });
    };

    return [
      {
        name: "list_modes",
        description:
          "List the persona modes available in this Light app (e.g. Concise, Explorer, Coder). Each mode has a system prompt and sampling preset.",
        readOnly: true,
        execute: async () => {
          report("list_modes");
          return {
            modes: MODES.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              temperature: m.temperature,
            })),
          };
        },
      },
      {
        name: "list_chats",
        description:
          "List the chat instances ('agents') the user has open, with their current mode and message count. Use to discover ids before switching, deleting, or sending.",
        readOnly: true,
        execute: async () => {
          report("list_chats");
          const { agents, activeAgent } = argsRef.current;
          return {
            activeChatId: activeAgent.id,
            chats: agents.map((a) => ({
              id: a.id,
              name: a.name,
              modeId: a.modeId,
              modeName: findMode(a.modeId).name,
              messageCount: a.messages.length,
              createdAt: a.createdAt,
            })),
          };
        },
      },
      {
        name: "new_chat",
        description:
          "Create a new chat instance and select it. Optionally specify a modeId from list_modes; defaults to the first mode.",
        inputSchema: {
          type: "object",
          properties: {
            modeId: { type: "string" },
          },
        },
        execute: async (input: unknown) => {
          const { modeId } = (input ?? {}) as { modeId?: string };
          const target = modeId ? findMode(modeId).id : undefined;
          const agent = argsRef.current.ops.create(target);
          report("new_chat", `→ ${agent.id}`);
          return { id: agent.id, modeId: agent.modeId };
        },
      },
      {
        name: "switch_chat",
        description:
          "Switch the active chat instance by id. Call list_chats first to learn valid ids.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
          },
          required: ["id"],
        },
        execute: async (input: unknown) => {
          const { id } = input as { id: string };
          const match = argsRef.current.agents.find((a) => a.id === id);
          if (!match) {
            report("switch_chat", `unknown id: ${id}`);
            throw new Error(`No chat with id "${id}".`);
          }
          argsRef.current.ops.select(id);
          report("switch_chat", `→ ${match.name}`);
          return { ok: true, activeChatId: id };
        },
      },
      {
        name: "delete_chat",
        description:
          "Delete a chat instance by id. Destructive: messages cannot be recovered. If the last chat is deleted, a fresh empty one is created.",
        destructive: true,
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
          },
          required: ["id"],
        },
        execute: async (input: unknown) => {
          const { id } = input as { id: string };
          const match = argsRef.current.agents.find((a) => a.id === id);
          if (!match) {
            report("delete_chat", `unknown id: ${id}`);
            throw new Error(`No chat with id "${id}".`);
          }
          argsRef.current.ops.remove(id);
          report("delete_chat", `× ${match.name}`);
          return { ok: true };
        },
      },
      {
        name: "set_mode",
        description:
          "Set the mode (persona) of the active chat. Call list_modes for valid ids.",
        inputSchema: {
          type: "object",
          properties: {
            modeId: { type: "string", minLength: 1 },
          },
          required: ["modeId"],
        },
        execute: async (input: unknown) => {
          const { modeId } = input as { modeId: string };
          const mode = MODES.find((m) => m.id === modeId);
          if (!mode) {
            report("set_mode", `unknown modeId: ${modeId}`);
            throw new Error(`No mode with id "${modeId}".`);
          }
          const { activeAgent, ops } = argsRef.current;
          ops.setMode(activeAgent.id, modeId);
          report("set_mode", `→ ${mode.name}`);
          return { ok: true, modeId };
        },
      },
      {
        name: "send_message",
        description:
          "Send a message to the active chat on behalf of the user. The agent's reply streams into the chat. Confirm wording with the user before sending sensitive content.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1 },
          },
          required: ["text"],
        },
        execute: async (input: unknown) => {
          const { text } = input as { text: string };
          report("send_message", text);
          await argsRef.current.send(text);
          return { ok: true };
        },
      },
      {
        name: "clear_chat",
        description:
          "Clear all messages in the active chat. Destructive: history cannot be recovered.",
        destructive: true,
        execute: async () => {
          argsRef.current.clear();
          report("clear_chat");
          return { ok: true };
        },
      },
    ];
  }, []);

  useWebMCP(tools);

  useEffect(() => {
    if (available) {
      argsRef.current.pushActivity({
        kind: "info",
        message: "WebMCP tools registered",
        detail: tools.map((t) => t.name).join(", "),
      });
    }
  }, [available, tools]);

  return { available };
}
