import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Chat,
  type Mode,
  DEFAULT_MODE_ID,
  createChat,
  findMode,
  loadState,
  saveState,
} from "./chats";
import type { ChatMessage } from "./types";

interface State {
  chats: Chat[];
  activeId: string;
}

export interface ChatOps {
  create(modeId?: string): Chat;
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

export interface UseChatsResult {
  chats: Chat[];
  activeChat: Chat;
  activeMode: Mode;
  activeId: string;
  ops: ChatOps;
}

export function useChats(): UseChatsResult {
  const [state, setState] = useState<State>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeChat = useMemo(
    () =>
      state.chats.find((c) => c.id === state.activeId) ?? state.chats[0],
    [state.chats, state.activeId],
  );

  const activeMode = useMemo(
    () => findMode(activeChat.modeId),
    [activeChat.modeId],
  );

  const create = useCallback((modeId: string = DEFAULT_MODE_ID): Chat => {
    const chat = createChat(modeId);
    setState((s) => ({ chats: [...s.chats, chat], activeId: chat.id }));
    return chat;
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => {
      const remaining = s.chats.filter((c) => c.id !== id);
      const list = remaining.length > 0 ? remaining : [createChat()];
      const activeId =
        s.activeId === id ? list[list.length - 1].id : s.activeId;
      return { chats: list, activeId };
    });
  }, []);

  const select = useCallback((id: string) => {
    setState((s) => (s.activeId === id ? s : { ...s, activeId: id }));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setState((s) => ({
      ...s,
      chats: s.chats.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  }, []);

  const setMode = useCallback((id: string, modeId: string) => {
    setState((s) => ({
      ...s,
      chats: s.chats.map((c) => (c.id === id ? { ...c, modeId } : c)),
    }));
  }, []);

  const appendMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      setState((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.id === id ? { ...c, messages: [...c.messages, ...messages] } : c,
        ),
      }));
    },
    [],
  );

  const updateMessage = useCallback(
    (id: string, messageId: string, patch: Partial<ChatMessage>) => {
      setState((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.id !== id
            ? c
            : {
                ...c,
                messages: c.messages.map((m) =>
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
      chats: s.chats.map((c) =>
        c.id === id ? { ...c, messages: [] } : c,
      ),
    }));
  }, []);

  const ops = useMemo<ChatOps>(
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
    chats: state.chats,
    activeChat,
    activeMode,
    activeId: state.activeId,
    ops,
  };
}
