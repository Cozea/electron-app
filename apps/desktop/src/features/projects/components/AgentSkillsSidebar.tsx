import * as React from "react";

import { NavUser } from "@/components/nav-user";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from "@/features/projects/components/sidebar/projectSidebarShared";
import { useTranslation } from "@/lib/i18n";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain01Icon as __AiBrainHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  BookOpenCheckIcon as __BookOpenCheckHugeIcon,
  FlashIcon as __FlashHugeIcon,
  CodeSquareIcon as __CodeSquareHugeIcon,
  CommandLineIcon as __CommandLineHugeIcon,
  Cursor01Icon as __CursorHugeIcon,
  FolderLibraryIcon as __FolderLibraryHugeIcon,
  LinkSquare02Icon as __LinkSquareHugeIcon,
  Search01Icon as __SearchHugeIcon,
} from "@hugeicons/core-free-icons";

interface AgentSkillsSidebarProps {
  user?: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
}

type SkillsView = "skills" | "builds";

type SourceFilter = "all" | "managed" | "external";
type ProviderFilter = "all" | "codex" | "claude" | "cursor" | "opencode";

const SOURCE_FILTERS: ReadonlyArray<{
  id: SourceFilter;
  labelKey: "agentSkills.filter.all" | "agentSkills.filter.managed" | "agentSkills.filter.external";
  icon: typeof __FolderLibraryHugeIcon;
}> = [
  { id: "all", labelKey: "agentSkills.filter.all", icon: __FolderLibraryHugeIcon },
  { id: "managed", labelKey: "agentSkills.filter.managed", icon: __BookOpenCheckHugeIcon },
  { id: "external", labelKey: "agentSkills.filter.external", icon: __LinkSquareHugeIcon },
];

/**
 * Every provider is a row rather than a dropdown: four is few enough to read at
 * a glance, and which agents a skill reaches is the thing this page is about.
 */
const PROVIDER_FILTERS: ReadonlyArray<{
  id: ProviderFilter;
  label: string;
  icon: typeof __FolderLibraryHugeIcon;
}> = [
  { id: "all", label: "All providers", icon: __BookOpenCheckHugeIcon },
  { id: "codex", label: "Codex", icon: __CommandLineHugeIcon },
  { id: "claude", label: "Claude", icon: __AiBrainHugeIcon },
  { id: "cursor", label: "Cursor", icon: __CursorHugeIcon },
  { id: "opencode", label: "OpenCode", icon: __CodeSquareHugeIcon },
];

/** Content-only: renders inside the persistent AppSidebarShell. */
export function AgentSkillsSidebar({ user }: AgentSkillsSidebarProps) {
  const { t } = useTranslation();
  const navigate = useViewTransitionNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const view = (searchParams.get("view") ?? "skills") as SkillsView;
  const source = (searchParams.get("source") ?? "all") as SourceFilter;
  const provider = (searchParams.get("provider") ?? "all") as ProviderFilter;

  const updateParams = React.useCallback(
    (changes: Partial<Record<"source" | "provider" | "view", string>>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(changes)) {
        // "all" and "skills" are the defaults, so they stay out of the URL.
        if (!value || value === "all" || value === "skills") next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const updateParam = React.useCallback(
    (key: "source" | "provider" | "view", value: string) => updateParams({ [key]: value }),
    [updateParams],
  );

  return (
    <>
      <SidebarHeader className="gap-3 px-3 pt-3 pb-2">
        <button
          type="button"
          className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
          onClick={() => navigate("/projects")}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          <span className="truncate">{t("projects.backToProjects")}</span>
        </button>

        <div className="relative">
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
          />
          <SidebarInput
            type="search"
            value={query}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.value.trim()) next.set("q", event.target.value);
              else next.delete("q");
              setSearchParams(next, { replace: true });
            }}
            placeholder={t("agentSkills.searchPlaceholder")}
            className="h-10 rounded-xl border-border/50 bg-muted pl-9 text-sm"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-5 px-2 py-1">
        <SidebarGroup className="px-0 py-0">
          <button
            type="button"
            aria-pressed={view === "builds"}
            className={cn(
              SIDEBAR_NAV_ROW_BUTTON_CLASS,
              view === "builds" && SIDEBAR_PILL_ACTIVE_CLASS,
            )}
            onClick={() => updateParam("view", "builds")}
          >
            <HugeiconsIcon icon={__FlashHugeIcon} />
            <span className="truncate">{t("nav.skillBuilds")}</span>
          </button>
        </SidebarGroup>

        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>
            {t("agentSkills.library")}
          </SidebarGroupLabel>
          <div className="space-y-1">
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={source === filter.id}
                className={cn(
                  SIDEBAR_NAV_ROW_BUTTON_CLASS,
                  source === filter.id && SIDEBAR_PILL_ACTIVE_CLASS,
                )}
                onClick={() => updateParams({ source: filter.id, view: "skills" })}
              >
                <HugeiconsIcon icon={filter.icon} />
                <span className="truncate">{t(filter.labelKey)}</span>
              </button>
            ))}
          </div>
        </SidebarGroup>

        {view === "builds" ? null : (
        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>
            {t("agentSkills.providers")}
          </SidebarGroupLabel>
          <div className="space-y-1">
            {PROVIDER_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={provider === filter.id}
                className={cn(
                  SIDEBAR_NAV_ROW_BUTTON_CLASS,
                  provider === filter.id && SIDEBAR_PILL_ACTIVE_CLASS,
                )}
                onClick={() => updateParam("provider", filter.id)}
              >
                <HugeiconsIcon icon={filter.icon} />
                <span className="truncate">
                  {filter.id === "all" ? t("agentSkills.providersAll") : filter.label}
                </span>
              </button>
            ))}
          </div>
        </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        <NavUser user={user} />
      </SidebarFooter>
    </>
  );
}
