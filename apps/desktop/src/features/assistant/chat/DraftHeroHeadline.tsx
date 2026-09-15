import type { CSSProperties, ComponentType } from "react";
import {
  LuBug,
  LuGitPullRequest,
  LuLayers,
  LuPlay,
  LuSparkles,
} from "react-icons/lu";

import { cn } from "@/lib/utils";
import { MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME } from "./draftHeroTransition";

export interface DraftStarterPrompt {
  id: string;
  title: string;
  description: string;
  prompt: string;
  icon?: ComponentType<{ className?: string }>;
}

export const DEFAULT_DRAFT_STARTER_PROMPTS: readonly DraftStarterPrompt[] = [
  {
    id: "review-staged",
    title: "Review Staged Changes",
    description: "Inspect git status and diffs for clean commit readiness",
    prompt: "Review staged git changes and suggest refinements",
    icon: LuGitPullRequest,
  },
  {
    id: "explain-architecture",
    title: "Explain Architecture",
    description: "Map key modules, entrypoints, and data flows",
    prompt: "Explain the high-level architecture and key components of this project",
    icon: LuLayers,
  },
  {
    id: "scan-bugs",
    title: "Scan for Bugs",
    description: "Find potential edge-case flaws and security issues",
    prompt: "Scan the current workspace for potential bugs, dead code, and security risks",
    icon: LuBug,
  },
  {
    id: "run-tests",
    title: "Run Test Suites",
    description: "Execute automated tests and diagnose failures",
    prompt: "Run the test suite and report any failures or regressions",
    icon: LuPlay,
  },
];

export interface DraftHeroHeadlineProps {
  projectName?: string | null;
  onSelectPrompt?: (prompt: string) => void;
  starterPrompts?: readonly DraftStarterPrompt[];
  className?: string;
}

export function DraftHeroHeadline({
  projectName,
  onSelectPrompt,
  starterPrompts = DEFAULT_DRAFT_STARTER_PROMPTS,
  className,
}: DraftHeroHeadlineProps) {
  const titleText = projectName
    ? `What should we build in ${projectName}?`
    : "What would you like to build today?";

  const subtitleText = "Select a starter suggestion or enter your own prompt below.";

  return (
    <div
      role="region"
      aria-label="Conversation starter"
      data-testid="draft-hero-container"
      className={cn(
        "flex w-full max-w-xl flex-col items-center gap-6 px-4 py-8 text-center animate-in fade-in duration-200",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/50 bg-background/80 shadow-xs ring-1 ring-border/20">
          <LuSparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <h2
            data-testid="draft-hero-title"
            className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
            style={
              {
                viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
              } as CSSProperties
            }
          >
            {titleText}
          </h2>
          <p
            data-testid="draft-hero-subtitle"
            className="text-xs text-muted-foreground sm:text-sm"
          >
            {subtitleText}
          </p>
        </div>
      </div>

      {starterPrompts.length > 0 && (
        <div
          data-testid="draft-starter-prompts-grid"
          className="grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2"
        >
          {starterPrompts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`draft-starter-prompt-${item.id}`}
                aria-label={`Starter prompt: ${item.title}`}
                onClick={() => onSelectPrompt?.(item.prompt)}
                className={cn(
                  "group relative flex flex-col items-start gap-1.5 rounded-xl border border-border/60 bg-card/60 p-3.5 transition-all duration-150",
                  "hover:border-primary/40 hover:bg-card/90 hover:shadow-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                  "active:scale-[0.99]",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  {Icon && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                </div>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
