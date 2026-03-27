import React, { memo, useRef, useEffect } from 'react';
import { useAgentChatStore } from '@/stores/useAgentChatStore';
import { ChatMarkdown } from './ChatMarkdown';
import { TerminalIcon, Loader2, CheckIcon, XIcon, UserIcon, BotIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export const MessagesTimeline = memo(({ threadId }: { threadId: string }) => {
  const messages = useAgentChatStore((state) => state.messagesByThread[threadId] || []);
  const toolCalls = useAgentChatStore((state) => state.toolCallsByThread[threadId] || []);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolCalls]);

  return (
    <ScrollArea ref={scrollRef} className="flex-1 px-4 py-6 app-scrollbar h-full min-h-0 bg-[var(--terminal-panel-bg,var(--content-surface))]">
      <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-4">
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex gap-3", msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role !== 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                <BotIcon className="h-4 w-4" />
              </div>
            )}
            
            <div className={cn("flex flex-col gap-2 max-w-[85%]", msg.role === 'user' ? 'items-end' : 'items-start')}>
              {msg.text && (
                <div className={cn(
                  "px-4 py-2.5 rounded-2xl text-sm",
                  msg.role === 'user' 
                    ? "bg-primary text-primary-foreground rounded-tr-sm" 
                    : "bg-muted/50 border border-border/50 rounded-tl-sm text-foreground"
                )}>
                  <ChatMarkdown content={msg.text} />
                </div>
              )}
              
              {/* Render Tool Calls for this message */}
              {toolCalls.filter(c => c.messageId === msg.id).map(call => (
                <div key={call.id} className="w-full rounded-md border border-border bg-card overflow-hidden text-sm shadow-sm mt-1">
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 border-b border-border/50">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <TerminalIcon className="h-3.5 w-3.5" />
                      <span className="font-mono text-[11px] font-medium">{call.toolName}</span>
                    </div>
                    <div>
                      {call.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                      {call.status === 'success' && <CheckIcon className="h-3 w-3 text-emerald-500" />}
                      {call.status === 'error' && <XIcon className="h-3 w-3 text-destructive" />}
                    </div>
                  </div>
                  
                  {call.output && (
                    <div className="p-3 bg-black/5 dark:bg-black/20 overflow-x-auto">
                      <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                        {call.output}
                      </pre>
                    </div>
                  )}
                  {call.error && (
                    <div className="p-3 bg-destructive/10 overflow-x-auto">
                      <pre className="text-[11px] font-mono text-destructive whitespace-pre-wrap break-all">
                        {call.error}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {msg.role === 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground border border-border/50">
                <UserIcon className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
});

MessagesTimeline.displayName = 'MessagesTimeline';
