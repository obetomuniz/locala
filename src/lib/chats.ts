import type { ChatMessage } from "./types";

export interface Mode {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  topK?: number;
}

export const MODES: Mode[] = [
  {
    id: "concise",
    name: "Concise",
    description: "Short, no-frills answers.",
    systemPrompt:
      "You are a precise assistant. Reply in one or two short sentences unless the user asks for more.",
    temperature: 0.2,
  },
  {
    id: "explorer",
    name: "Explorer",
    description: "Thinks out loud, suggests options.",
    systemPrompt:
      "You are a curious collaborator. Explore the question, surface trade-offs, and propose 2-3 directions before recommending one.",
    temperature: 0.7,
  },
  {
    id: "coder",
    name: "Coder",
    description: "TypeScript / web platform focus.",
    systemPrompt:
      "You are a senior web engineer. Prefer TypeScript and modern browser APIs. Show small, runnable snippets.",
    temperature: 0.3,
  },
];

export const DEFAULT_MODE_ID = MODES[0].id;

export const findMode = (id: string): Mode =>
  MODES.find((m) => m.id === id) ?? MODES[0];

export interface Chat {
  id: string;
  name: string;
  modeId: string;
  messages: ChatMessage[];
  createdAt: number;
}

export const DEFAULT_CHAT_NAME = "New chat";

export function createChat(modeId: string = DEFAULT_MODE_ID): Chat {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_CHAT_NAME,
    modeId,
    messages: [],
    createdAt: Date.now(),
  };
}

interface PersistedState {
  chats: Chat[];
  activeId: string;
}

const STORAGE_KEY = "locala:v2:state";
const LEGACY_STORAGE_KEY = "locala:v1:state";

function isChat(value: unknown): value is Chat {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Chat>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.modeId === "string" &&
    Array.isArray(c.messages) &&
    typeof c.createdAt === "number"
  );
}

export function loadState(): PersistedState {
  try {
    // One-shot cleanup of the v1 key. The shape changed (chats / chatId)
    // and we deliberately reset rather than migrate.
    if (localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (
        parsed &&
        Array.isArray(parsed.chats) &&
        parsed.chats.length > 0 &&
        parsed.chats.every(isChat)
      ) {
        const activeId =
          parsed.chats.find((c) => c.id === parsed.activeId)?.id ??
          parsed.chats[0].id;
        return { chats: parsed.chats, activeId };
      }
    }
  } catch {
    // fall through to default
  }
  const first = createChat();
  return { chats: [first], activeId: first.id };
}

export function saveState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / disabled storage
  }
}

const CHAT_NAME_LIMIT = 32;

export function deriveChatName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_CHAT_NAME;
  if (trimmed.length <= CHAT_NAME_LIMIT) return trimmed;
  return `${trimmed.slice(0, CHAT_NAME_LIMIT - 1)}…`;
}
