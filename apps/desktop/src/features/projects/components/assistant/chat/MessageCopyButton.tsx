

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, DocumentAttachmentIcon as __CopyIconHugeIcon } from '@hugeicons/core-free-icons'

import { memo } from "react";
import { Button } from "../ui/button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

export const MessageCopyButton = memo(function MessageCopyButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => copyToClipboard(text)}
      title="Copy message"
      aria-label="Copy message"
    >
      {isCopied ? <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-3 text-success" /> : <HugeiconsIcon icon={__CopyIconHugeIcon} className="size-3" />}
    </Button>
  );
});
