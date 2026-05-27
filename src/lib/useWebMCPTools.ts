import { useEffect, useMemo, useRef } from "react";
import { defineTool, isAvailable as isWebMCPAvailable, type Tool } from "@web-ai-sdk/webmcp";
import { useWebMCP } from "@web-ai-sdk/webmcp/react";
import * as v from "valibot";
import { MODES, findMode, type Chat } from "./chats";
import type { ChatOps } from "./useChats";
import type { ActivityEvent } from "./types";

interface Args {
  chats: Chat[];
  activeChat: Chat;
  ops: ChatOps;
  send: (text: string) => Promise<void> | void;
  clear: () => void;
  pushActivity: (event: Omit<ActivityEvent, "id" | "ts">) => void;
}

const SwitchChatInput = v.object({ id: v.pipe(v.string(), v.minLength(1)) });
const DeleteChatInput = SwitchChatInput;
const NewChatInput = v.object({ modeId: v.optional(v.string()) });
const SetModeInput = v.object({ modeId: v.pipe(v.string(), v.minLength(1)) });
const SendMessageInput = v.object({
  text: v.pipe(v.string(), v.minLength(1)),
});

export function useWebMCPTools(args: Args) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const available = isWebMCPAvailable();

  // defineTool returns Tool<InferredInput, ...> per tool; Tool's TInput is
  // invariant, so a heterogeneous array needs the cast at the boundary.
  const tools = useMemo<Tool[]>(() => {
    const report = (name: string, detail?: string) => {
      argsRef.current.pushActivity({
        kind: "tool_invoked",
        message: name,
        detail,
      });
    };

    const built = [
      defineTool({
        name: "list_modes",
        description:
          "List the persona modes available in this Locala app (e.g. Concise, Explorer, Coder). Each mode has a system prompt and sampling preset.",
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
      }),
      defineTool({
        name: "list_chats",
        description:
          "List the chat instances the user has open, with their current mode and message count. Use to discover ids before switching, deleting, or sending.",
        readOnly: true,
        execute: async () => {
          report("list_chats");
          const { chats, activeChat } = argsRef.current;
          return {
            activeChatId: activeChat.id,
            chats: chats.map((c) => ({
              id: c.id,
              name: c.name,
              modeId: c.modeId,
              modeName: findMode(c.modeId).name,
              messageCount: c.messages.length,
              createdAt: c.createdAt,
            })),
          };
        },
      }),
      defineTool({
        name: "new_chat",
        description:
          "Create a new chat instance and select it. Optionally specify a modeId from list_modes; defaults to the first mode.",
        input: NewChatInput,
        inputSchema: {
          type: "object",
          properties: { modeId: { type: "string" } },
        },
        execute: async ({ modeId }) => {
          const target = modeId ? findMode(modeId).id : undefined;
          const chat = argsRef.current.ops.create(target);
          report("new_chat", `→ ${chat.id}`);
          return { id: chat.id, modeId: chat.modeId };
        },
      }),
      defineTool({
        name: "switch_chat",
        description:
          "Switch the active chat instance by id. Call list_chats first to learn valid ids.",
        input: SwitchChatInput,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", minLength: 1 } },
          required: ["id"],
        },
        execute: async ({ id }) => {
          const match = argsRef.current.chats.find((c) => c.id === id);
          if (!match) {
            report("switch_chat", `unknown id: ${id}`);
            throw new Error(`No chat with id "${id}".`);
          }
          argsRef.current.ops.select(id);
          report("switch_chat", `→ ${match.name}`);
          return { ok: true, activeChatId: id };
        },
      }),
      defineTool({
        name: "delete_chat",
        description:
          "Delete a chat instance by id. Destructive: messages cannot be recovered. If the last chat is deleted, a fresh empty one is created.",
        destructive: true,
        input: DeleteChatInput,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", minLength: 1 } },
          required: ["id"],
        },
        execute: async ({ id }) => {
          const match = argsRef.current.chats.find((c) => c.id === id);
          if (!match) {
            report("delete_chat", `unknown id: ${id}`);
            throw new Error(`No chat with id "${id}".`);
          }
          argsRef.current.ops.remove(id);
          report("delete_chat", `× ${match.name}`);
          return { ok: true };
        },
      }),
      defineTool({
        name: "set_mode",
        description:
          "Set the mode (persona) of the active chat. Call list_modes for valid ids.",
        input: SetModeInput,
        inputSchema: {
          type: "object",
          properties: { modeId: { type: "string", minLength: 1 } },
          required: ["modeId"],
        },
        execute: async ({ modeId }) => {
          const mode = MODES.find((m) => m.id === modeId);
          if (!mode) {
            report("set_mode", `unknown modeId: ${modeId}`);
            throw new Error(`No mode with id "${modeId}".`);
          }
          const { activeChat, ops } = argsRef.current;
          ops.setMode(activeChat.id, modeId);
          report("set_mode", `→ ${mode.name}`);
          return { ok: true, modeId };
        },
      }),
      defineTool({
        name: "send_message",
        description:
          "Send a message to the active chat on behalf of the user. The reply streams into the chat. Confirm wording with the user before sending sensitive content.",
        input: SendMessageInput,
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", minLength: 1 } },
          required: ["text"],
        },
        execute: async ({ text }) => {
          report("send_message", text);
          await argsRef.current.send(text);
          return { ok: true };
        },
      }),
      defineTool({
        name: "clear_chat",
        description:
          "Clear all messages in the active chat. Destructive: history cannot be recovered.",
        destructive: true,
        execute: async () => {
          argsRef.current.clear();
          report("clear_chat");
          return { ok: true };
        },
      }),
    ];
    return built as unknown as Tool[];
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
