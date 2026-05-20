import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Agent,
  type Mode,
  DEFAULT_MODE_ID,
  createAgent,
  findMode,
  loadState,
  saveState,
} from "./agents";
import type { ChatMessage } from "./types";

interface State {
  agents: Agent[];
  activeId: string;
}

export interface AgentOps {
  create(modeId?: string): Agent;
  remove(id: string): void;
  select(id: string): void;
  rename(id: string, name: string): void;
  setMode(id: string, modeId: string): void;
  appendMessages(id: string, messages: ChatMessage[]): void;
  updateMessage(
    id: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ): void;
  clearMessages(id: string): void;
}

export interface UseAgentsResult {
  agents: Agent[];
  activeAgent: Agent;
  activeMode: Mode;
  activeId: string;
  ops: AgentOps;
}

export function useAgents(): UseAgentsResult {
  const [state, setState] = useState<State>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeAgent = useMemo(
    () =>
      state.agents.find((a) => a.id === state.activeId) ?? state.agents[0],
    [state.agents, state.activeId],
  );

  const activeMode = useMemo(
    () => findMode(activeAgent.modeId),
    [activeAgent.modeId],
  );

  const create = useCallback((modeId: string = DEFAULT_MODE_ID): Agent => {
    const agent = createAgent(modeId);
    setState((s) => ({ agents: [...s.agents, agent], activeId: agent.id }));
    return agent;
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => {
      const remaining = s.agents.filter((a) => a.id !== id);
      const list = remaining.length > 0 ? remaining : [createAgent()];
      const activeId =
        s.activeId === id ? list[list.length - 1].id : s.activeId;
      return { agents: list, activeId };
    });
  }, []);

  const select = useCallback((id: string) => {
    setState((s) => (s.activeId === id ? s : { ...s, activeId: id }));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setState((s) => ({
      ...s,
      agents: s.agents.map((a) => (a.id === id ? { ...a, name } : a)),
    }));
  }, []);

  const setMode = useCallback((id: string, modeId: string) => {
    setState((s) => ({
      ...s,
      agents: s.agents.map((a) => (a.id === id ? { ...a, modeId } : a)),
    }));
  }, []);

  const appendMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      setState((s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id === id ? { ...a, messages: [...a.messages, ...messages] } : a,
        ),
      }));
    },
    [],
  );

  const updateMessage = useCallback(
    (id: string, messageId: string, patch: Partial<ChatMessage>) => {
      setState((s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id !== id
            ? a
            : {
                ...a,
                messages: a.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m,
                ),
              },
        ),
      }));
    },
    [],
  );

  const clearMessages = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, messages: [] } : a,
      ),
    }));
  }, []);

  const ops = useMemo<AgentOps>(
    () => ({
      create,
      remove,
      select,
      rename,
      setMode,
      appendMessages,
      updateMessage,
      clearMessages,
    }),
    [
      create,
      remove,
      select,
      rename,
      setMode,
      appendMessages,
      updateMessage,
      clearMessages,
    ],
  );

  return {
    agents: state.agents,
    activeAgent,
    activeMode,
    activeId: state.activeId,
    ops,
  };
}
