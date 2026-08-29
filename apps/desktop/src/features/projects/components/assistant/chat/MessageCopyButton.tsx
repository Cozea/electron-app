

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, Copy01Icon as __CopyIconHugeIcon } from '@hugeicons/core-free-icons'

import { memo } from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground",
        className,
      )}
      onClick={() => copyToClipboard(text)}
      title={isCopied ? "Copied!" : "Copy message"}
      aria-label={isCopied ? "Copied!" : "Copy message"}
    >
      {isCopied ? (
        <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-3.5 text-success" />
      ) : (
        <HugeiconsIcon icon={__CopyIconHugeIcon} className="size-3.5" />
      )}
    </button>
  );
});
