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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ArrowDown01Icon as __ArrowDownHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  BookOpenCheckIcon as __BookOpenCheckHugeIcon,
  FolderLibraryIcon as __FolderLibraryHugeIcon,
  LinkSquare02Icon as __LinkSquareHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Tick02Icon as __TickHugeIcon,
} from "@hugeicons/core-free-icons";

interface AgentSkillsSidebarProps {
  user?: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
}

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

const PROVIDER_FILTERS: ReadonlyArray<{ id: ProviderFilter; label: string }> = [
  { id: "all", label: "All providers" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
  { id: "opencode", label: "OpenCode" },
];

/** Content-only: renders inside the persistent AppSidebarShell. */
export function AgentSkillsSidebar({ user }: AgentSkillsSidebarProps) {
  const { t } = useTranslation();
  const navigate = useViewTransitionNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const source = (searchParams.get("source") ?? "all") as SourceFilter;
  const provider = (searchParams.get("provider") ?? "all") as ProviderFilter;
  const providerLabel =
    provider === "all"
      ? t("agentSkills.providersAll")
      : (PROVIDER_FILTERS.find((filter) => filter.id === provider)?.label ??
        t("agentSkills.providersAll"));

  const updateParam = React.useCallback(
    (key: "source" | "provider", value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === "all") next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
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
                onClick={() => updateParam("source", filter.id)}
              >
                <HugeiconsIcon icon={filter.icon} />
                <span className="truncate">{t(filter.labelKey)}</span>
              </button>
            ))}
          </div>
        </SidebarGroup>

        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>
            {t("agentSkills.providers")}
          </SidebarGroupLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${t("agentSkills.providers")}: ${providerLabel}`}
                className={cn(
                  SIDEBAR_NAV_ROW_BUTTON_CLASS,
                  provider !== "all" && SIDEBAR_PILL_ACTIVE_CLASS,
                )}
              >
                <HugeiconsIcon icon={__BookOpenCheckHugeIcon} />
                <span className="min-w-0 flex-1 truncate text-left">{providerLabel}</span>
                <HugeiconsIcon icon={__ArrowDownHugeIcon} className="ml-auto size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-44">
              {PROVIDER_FILTERS.map((filter) => (
                <DropdownMenuItem
                  key={filter.id}
                  onClick={() => updateParam("provider", filter.id)}
                  className="justify-between"
                >
                  <span>
                    {filter.id === "all" ? t("agentSkills.providersAll") : filter.label}
                  </span>
                  {provider === filter.id ? (
                    <HugeiconsIcon icon={__TickHugeIcon} className="size-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        <NavUser user={user} />
      </SidebarFooter>
    </>
  );
}
