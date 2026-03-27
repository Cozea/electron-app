// @ts-nocheck
import React, { useMemo } from 'react';
import { useAgentChatStore } from '@/stores/useAgentChatStore';
import { MessagesTimeline } from './MessagesTimeline';

export function NativeChatView({ threadId }: { threadId: string }) {
  const messages = useAgentChatStore((state) => state.messagesByThread[threadId] || []);
  const toolCalls = useAgentChatStore((state) => state.toolCallsByThread[threadId] || []);

  // Map our simple IPC state to t3code's ChatMessage and WorkLogEntry format
  const t3Messages = useMemo(() => {
    return messages.map(msg => ({
      id: msg.id,
      turnId: msg.id, // Mock
      role: msg.role,
      createdAt: new Date(msg.createdAt).toISOString(),
      text: msg.text,
      // Provide defaults for their interface
      metadata: {},
      isCheckpoint: false
    }));
  }, [messages]);

  const t3WorkEntries = useMemo(() => {
    return toolCalls.map(call => ({
      id: call.id,
      turnId: call.messageId || 'unknown',
      toolName: call.toolName,
      input: call.input,
      output: call.output,
      error: call.error,
      status: call.status === 'running' ? 'active' : call.status === 'success' ? 'success' : 'error',
      startedAt: new Date(call.startedAt).toISOString(),
      endedAt: call.endedAt ? new Date(call.endedAt).toISOString() : undefined,
    }));
  }, [toolCalls]);

  const timelineEntries = useMemo(() => {
    // We implement a simplified deriveTimelineEntries here to bypass all their complex session logic 
    // but still yield exactly the TimelineEntry array format MessagesTimeline expects!
    
    const entries = [];
    for (const msg of t3Messages) {
      entries.push({
        id: msg.id,
        kind: "message",
        createdAt: msg.createdAt,
        message: msg,
        durationStart: msg.createdAt,
        showCompletionDivider: false
      });
      
      // Find tools that belong to this message
      const tools = t3WorkEntries.filter(t => t.turnId === msg.id);
      if (tools.length > 0) {
        entries.push({
          id: `work-\${msg.id}`,
          kind: "work",
          createdAt: tools[0].startedAt,
          groupedEntries: tools
        });
      }
    }
    return entries;
  }, [t3Messages, t3WorkEntries]);

  return (
    <MessagesTimeline 
      hasMessages={timelineEntries.length > 0}
      isWorking={toolCalls.some(c => c.status === 'running')}
      activeTurnInProgress={toolCalls.some(c => c.status === 'running')}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={timelineEntries as any}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso={new Date().toISOString()}
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="dark"
      timestampFormat="12h"
      workspaceRoot={undefined}
    />
  );
}
