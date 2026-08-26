

import { HugeiconsIcon } from '@hugeicons/react'
import { DocumentAttachmentIcon as __FileIconHugeIcon, Folder01Icon as __FolderIconHugeIcon } from '@hugeicons/core-free-icons'

import { memo, useMemo, useState } from "react";
import { getVscodeIconUrlForEntry } from "../vscode-icons";
import { cn } from "@/lib/utils";

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = useMemo(
    () => getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme),
    [props.kind, props.pathValue, props.theme],
  );
  const failed = failedIconUrl === iconUrl;

  if (failed) {
    return props.kind === "directory" ? (
      <HugeiconsIcon icon={__FolderIconHugeIcon} className={cn("size-4 text-muted-foreground/80", props.className)} />
    ) : (
      <HugeiconsIcon icon={__FileIconHugeIcon} className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});
