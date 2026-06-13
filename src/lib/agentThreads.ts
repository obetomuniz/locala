import type { AgentTurn } from "../experimental/agent/types";
import { PRESETS } from "../experimental/playground/presets";

export interface AgentThreadTurn extends AgentTurn {
  id: string;
  createdAt: number;
}

export interface AgentThread {
  id: string;
  name: string;
  skillId: string;
  turns: AgentThreadTurn[];
  createdAt: number;
}

export interface AgentThreadState {
  threads: AgentThread[];
  activeId: string;
}

export const DEFAULT_SKILL_ID = "platform";
export const DEFAULT_THREAD_NAME = "New thread";

export const STORAGE_KEY = "locala:v3:agent-threads";
const LEGACY_AGENT_STORAGE_KEY = "locala:v2:agent-threads";
const THREAD_NAME_LIMIT = 32;

export function findSkill(id: string) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function createAgentThread(
  skillId: string = DEFAULT_SKILL_ID,
): AgentThread {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_THREAD_NAME,
    skillId: findSkill(skillId).id,
    turns: [],
    createdAt: Date.now(),
  };
}

export function deriveThreadName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_THREAD_NAME;
  if (trimmed.length <= THREAD_NAME_LIMIT) return trimmed;
  return `${trimmed.slice(0, THREAD_NAME_LIMIT - 1)}...`;
}

function isThreadTurn(value: unknown): value is AgentThreadTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<AgentThreadTurn>;
  return (
    typeof turn.id === "string" &&
    typeof turn.createdAt === "number" &&
    typeof turn.userInput === "string" &&
    typeof turn.assistantText === "string" &&
    Array.isArray(turn.steps)
  );
}

function isThread(value: unknown): value is AgentThread {
  if (!value || typeof value !== "object") return false;
  const thread = value as Partial<AgentThread>;
  return (
    typeof thread.id === "string" &&
    typeof thread.name === "string" &&
    typeof thread.skillId === "string" &&
    Array.isArray(thread.turns) &&
    thread.turns.every(isThreadTurn) &&
    typeof thread.createdAt === "number"
  );
}

export function loadAgentThreadState(): AgentThreadState {
  try {
    if (localStorage.getItem(LEGACY_AGENT_STORAGE_KEY) !== null) {
      localStorage.removeItem(LEGACY_AGENT_STORAGE_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AgentThreadState;
      if (
        parsed &&
        Array.isArray(parsed.threads) &&
        parsed.threads.length > 0 &&
        parsed.threads.every(isThread)
      ) {
        const activeId =
          parsed.threads.find((thread) => thread.id === parsed.activeId)?.id ??
          parsed.threads[0].id;
        return { threads: parsed.threads, activeId };
      }
    }
  } catch {
    // fall through to default
  }

  const first = createAgentThread();
  return { threads: [first], activeId: first.id };
}

export function saveAgentThreadState(state: AgentThreadState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / disabled storage
  }
}
