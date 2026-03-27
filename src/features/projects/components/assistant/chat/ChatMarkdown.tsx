import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export const ChatMarkdown = memo(({ content, className }: { content: string, className?: string }) => {
  return (
    <div className={cn("prose dark:prose-invert prose-sm max-w-none break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

ChatMarkdown.displayName = 'ChatMarkdown';
