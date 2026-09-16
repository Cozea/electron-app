

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
        "cursor-pointer p-0.5 text-muted-foreground/70 transition-[background-color,color,transform] duration-150 active:scale-90 hover:text-foreground",
        className,
      )}
      onClick={() => copyToClipboard(text)}
      title={isCopied ? "Copied!" : "Copy message"}
      aria-label={isCopied ? "Copied!" : "Copy message"}
    >
      <span className="t-icon-swap size-3.5 shrink-0" data-state={isCopied ? "copied" : "copy"}>
        <span className="t-icon flex items-center justify-center" data-icon="copy">
          <HugeiconsIcon icon={__CopyIconHugeIcon} className="size-3.5" />
        </span>
        <span className="t-icon flex items-center justify-center" data-icon="copied">
          <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-3.5 text-emerald-500" />
        </span>
      </span>
    </button>
  );
});
