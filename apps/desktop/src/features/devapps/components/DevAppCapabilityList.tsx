import { HugeiconsIcon } from "@hugeicons/react";
import {
  CommandLineIcon,
  CpuChargeIcon,
  Edit01Icon,
  Folder01Icon,
  FolderOpenIcon,
  GitMergeIcon,
  Globe02Icon,
  InformationCircleIcon,
  Shield01Icon,
  SparklesIcon,
  SquareArrowDownRightIcon,
} from "@hugeicons/core-free-icons";

import {
  isDevAppCapability,
  type DevAppCapability,
} from "@shared/devAppCapabilities";
import { cn } from "@/lib/utils";

const CAPABILITY_LABELS: Record<DevAppCapability, string> = {
  "project.metadata": "Project details",
  "project.read": "Read project files",
  "project.write": "Change project files",
  "git.read": "Git history and branches",
  "git.write": "Git operations",
  "fs.read": "Filesystem read",
  "fs.write": "Filesystem write",
  "terminal.spawn": "Run terminal commands",
  "process.spawn": "Launch processes",
  "net.outbound": "Network access",
  "shell.open": "Open browser links",
  "shell.reveal": "Show in Finder",
};

const CAPABILITY_ICONS = {
  "project.metadata": InformationCircleIcon,
  "project.read": Folder01Icon,
  "project.write": Edit01Icon,
  "git.read": GitMergeIcon,
  "git.write": GitMergeIcon,
  "fs.read": FolderOpenIcon,
  "fs.write": Folder01Icon,
  "terminal.spawn": CommandLineIcon,
  "process.spawn": CpuChargeIcon,
  "net.outbound": Globe02Icon,
  "shell.open": SquareArrowDownRightIcon,
  "shell.reveal": FolderOpenIcon,
} as const;

function ImmutableCheckbox() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border/80 bg-muted/60 text-foreground/80 select-none"
    >
      <svg
        className="size-2.5 stroke-[2.5]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 12.75l6 6 9-13.5"
        />
      </svg>
    </span>
  );
}

interface DevAppCapabilityListProps {
  capabilities: ReadonlyArray<string | DevAppCapability>;
  agentInvocable?: boolean;
  className?: string;
}

export function DevAppCapabilityList({
  capabilities,
  agentInvocable,
  className,
}: DevAppCapabilityListProps) {
  if (capabilities.length === 0 && !agentInvocable) return null;

  return (
    <div className={cn("w-full space-y-1 text-left", className)}>
      <div className="divide-y divide-border/20">
        {capabilities.map((cap) => {
          const isKnown = isDevAppCapability(cap);
          const icon = isKnown ? CAPABILITY_ICONS[cap] : Shield01Icon;
          const label = isKnown ? CAPABILITY_LABELS[cap] : cap;

          return (
            <div key={cap} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
              <ImmutableCheckbox />
              <HugeiconsIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">{label}</span>
            </div>
          );
        })}
        {agentInvocable ? (
          <div className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
            <ImmutableCheckbox />
            <HugeiconsIcon
              icon={SparklesIcon}
              className="size-4 shrink-0 text-purple-500 dark:text-purple-400"
            />
            <span className="text-xs font-medium text-foreground">Autonomous agent access</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
