import { create } from 'zustand';
import type { AgentChatMessage, AgentChatToolCall, AgentChatThread } from '../../shared/agentChatTypes';

interface AgentChatState {
  threads: Record<string, AgentChatThread>;
  messagesByThread: Record<string, AgentChatMessage[]>;
  toolCallsByThread: Record<string, AgentChatToolCall[]>;
  activeThreadId: string | null;

  setActiveThreadId: (id: string | null) => void;
  loadThread: (projectId: string, threadId: string) => Promise<void>;
  createThread: (projectId: string, title: string) => Promise<string>;
  appendMessage: (message: AgentChatMessage) => void;
  appendToolCall: (toolCall: AgentChatToolCall) => void;
  updateToolCall: (toolCallId: string, threadId: string, updates: Partial<AgentChatToolCall>) => void;
  
  handleStreamEvent: (event: any) => void;
}

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  threads: {},
  messagesByThread: {},
  toolCallsByThread: {},
  activeThreadId: null,

  setActiveThreadId: (id) => set({ activeThreadId: id }),

  loadThread: async (_projectId, threadId) => {
    // @ts-ignore
    const data = await window.electronAPI?.agentChat?.getThread(threadId);
    if (data) {
      set((state) => ({
        threads: { ...state.threads, [threadId]: data.thread },
        messagesByThread: { ...state.messagesByThread, [threadId]: data.messages },
        toolCallsByThread: { ...state.toolCallsByThread, [threadId]: data.toolCalls },
        activeThreadId: threadId,
      }));
    }
  },

  createThread: async (projectId, title) => {
    const id = crypto.randomUUID();
    // @ts-ignore
    await window.electronAPI?.agentChat?.createThread({ id, projectId, title });
    set((state) => ({
      threads: { ...state.threads, [id]: { id, projectId, title, createdAt: Date.now(), updatedAt: Date.now() } },
      messagesByThread: { ...state.messagesByThread, [id]: [] },
      toolCallsByThread: { ...state.toolCallsByThread, [id]: [] },
      activeThreadId: id,
    }));
    return id;
  },

  appendMessage: (message) => set((state) => {
    const threadMsgs = state.messagesByThread[message.threadId] || [];
    return {
      messagesByThread: {
        ...state.messagesByThread,
        [message.threadId]: [...threadMsgs, message]
      }
    };
  }),

  appendToolCall: (toolCall) => set((state) => {
    const calls = state.toolCallsByThread[toolCall.threadId] || [];
    return {
      toolCallsByThread: {
        ...state.toolCallsByThread,
        [toolCall.threadId]: [...calls, toolCall]
      }
    };
  }),

  updateToolCall: (id, threadId, updates) => set((state) => {
    const calls = state.toolCallsByThread[threadId] || [];
    return {
      toolCallsByThread: {
        ...state.toolCallsByThread,
        [threadId]: calls.map(c => c.id === id ? { ...c, ...updates } : c)
      }
    };
  }),

  handleStreamEvent: (event) => {
    const { threadId, type, payload } = event;
    const { appendMessage, appendToolCall, updateToolCall } = get();

    if (type === 'assistant_message') {
      appendMessage({
        id: payload.uuid,
        threadId,
        role: 'assistant',
        text: payload.content?.text || '',
        createdAt: Date.now()
      });
    } else if (type === 'tool_call') {
      appendToolCall({
        id: payload.uuid,
        messageId: payload.parentUuid || '',
        threadId,
        toolName: payload.name,
        input: payload.input,
        status: 'running',
        startedAt: Date.now()
      });
    } else if (type === 'tool_result') {
      updateToolCall(payload.toolCallUuid, threadId, {
        status: payload.error ? 'error' : 'success',
        output: typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result),
        error: payload.error,
        endedAt: Date.now()
      });
    } else if (type === 'text_delta') {
      set((state) => {
        const msgs = state.messagesByThread[threadId] || [];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          return {
            messagesByThread: {
              ...state.messagesByThread,
              [threadId]: msgs.map((m, i) => i === msgs.length - 1 ? { ...m, text: m.text + payload.delta } : m)
            }
          };
        }
        return state;
      });
    }
  }
}));

if (typeof window !== 'undefined') {
  // @ts-ignore
  if (window.electronAPI?.agentProvider) {
    // @ts-ignore
    window.electronAPI.agentProvider.onEventStream((event: any) => {
      useAgentChatStore.getState().handleStreamEvent(event);
    });
  }
}
