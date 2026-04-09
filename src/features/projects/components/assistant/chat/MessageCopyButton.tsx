// @ts-nocheck
import { memo } from "react";
import { CheckIcon, DocumentDuplicateIcon as CopyIcon } from "@heroicons/react/24/outline"
import { Button } from "../ui/button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

export const MessageCopyButton = memo(function MessageCopyButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => copyToClipboard(text)}
      title="Copy message"
      aria-label="Copy message"
    >
      {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
    </Button>
  );
});
