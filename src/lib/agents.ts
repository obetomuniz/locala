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

export interface Agent {
  id: string;
  name: string;
  modeId: string;
  messages: ChatMessage[];
  createdAt: number;
}

export const DEFAULT_AGENT_NAME = "New chat";

export function createAgent(modeId: string = DEFAULT_MODE_ID): Agent {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_AGENT_NAME,
    modeId,
    messages: [],
    createdAt: Date.now(),
  };
}

interface PersistedState {
  agents: Agent[];
  activeId: string;
}

const STORAGE_KEY = "locala:v1:state";

function isAgent(value: unknown): value is Agent {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<Agent>;
  return (
    typeof a.id === "string" &&
    typeof a.name === "string" &&
    typeof a.modeId === "string" &&
    Array.isArray(a.messages) &&
    typeof a.createdAt === "number"
  );
}

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (
        parsed &&
        Array.isArray(parsed.agents) &&
        parsed.agents.length > 0 &&
        parsed.agents.every(isAgent)
      ) {
        const activeId =
          parsed.agents.find((a) => a.id === parsed.activeId)?.id ??
          parsed.agents[0].id;
        return { agents: parsed.agents, activeId };
      }
    }
  } catch {
    // fall through to default
  }
  const first = createAgent();
  return { agents: [first], activeId: first.id };
}

export function saveState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / disabled storage
  }
}

const AGENT_NAME_LIMIT = 32;

export function deriveAgentName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_AGENT_NAME;
  if (trimmed.length <= AGENT_NAME_LIMIT) return trimmed;
  return `${trimmed.slice(0, AGENT_NAME_LIMIT - 1)}…`;
}
