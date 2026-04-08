import { Check } from "lucide-react";

import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome";
import { Switch } from "../../components/ui/switch";
import { useTheme } from "../../contexts/ThemeContext";
import type { Theme } from "@/lib/theme";
import { cn } from "../../lib/utils";

interface AppearanceProps {
  surface?: "page" | "drawer";
  route?: string;
}

const themes: {
  value: Theme;
  label: string;
  colors: { bg: string; card: string; primary: string; muted: string };
}[] = [
  {
    value: "light",
    label: "Light",
    colors: { bg: "#ffffff", card: "#ffffff", primary: "#1a1a2e", muted: "#f5f5f5" },
  },
  {
    value: "dark",
    label: "Dark",
    colors: { bg: "#1a1a1a", card: "#262626", primary: "#e5e5e5", muted: "#404040" },
  },
  {
    value: "navy",
    label: "Navy",
    colors: { bg: "#0f1729", card: "#141d30", primary: "#5a9cf5", muted: "#1e2a42" },
  },
  {
    value: "wine",
    label: "Wine",
    colors: { bg: "#2a1520", card: "#321a24", primary: "#d64074", muted: "#3d2430" },
  },
  {
    value: "clay",
    label: "Clay",
    colors: { bg: "#1c1814", card: "#252019", primary: "#c4956a", muted: "#2e2822" },
  },
  {
    value: "forest",
    label: "Forest",
    colors: { bg: "#142118", card: "#1a2b20", primary: "#3d7a57", muted: "#243d2d" },
  },
  {
    value: "system",
    label: "System",
    colors: {
      bg: "linear-gradient(135deg, #ffffff 50%, #1a1a1a 50%)",
      card: "",
      primary: "",
      muted: "",
    },
  },
];

export function Appearance({ surface = "page", route: _route }: AppearanceProps) {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>Theme</SettingsSectionTitle>
        <SettingsSectionDescription>Choose your preferred color scheme</SettingsSectionDescription>
        <SettingsGroup className="p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {themes.map((t) => {
              const isSelected = theme === t.value;
              const isSystem = t.value === "system";

              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    "relative flex flex-col overflow-hidden rounded-lg transition-all",
                    "hover:ring-2 hover:ring-ring/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected && "ring-2 ring-primary",
                  )}
                >
                  <div className="aspect-[4/3] p-2" style={{ background: t.colors.bg }}>
                    {isSystem ? (
                      <div className="flex h-full">
                        <div className="flex w-1/2 flex-col gap-1 p-1.5">
                          <div className="h-1.5 w-6 rounded-sm bg-[#1a1a2e]" />
                          <div className="flex-1 rounded bg-[#f5f5f5] p-1">
                            <div className="mb-1 h-1 w-full rounded-sm bg-[#e5e5e5]" />
                            <div className="h-1 w-3/4 rounded-sm bg-[#e5e5e5]" />
                          </div>
                          <div className="h-2 w-8 rounded-sm bg-[#1a1a2e]" />
                        </div>
                        <div className="flex w-1/2 flex-col gap-1 bg-[#1a1a1a] p-1.5">
                          <div className="h-1.5 w-6 rounded-sm bg-[#e5e5e5]" />
                          <div className="flex-1 rounded bg-[#262626] p-1">
                            <div className="mb-1 h-1 w-full rounded-sm bg-[#404040]" />
                            <div className="h-1 w-3/4 rounded-sm bg-[#404040]" />
                          </div>
                          <div className="h-2 w-8 rounded-sm bg-[#e5e5e5]" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col gap-1">
                        <div className="h-1.5 w-8 rounded-sm" style={{ backgroundColor: t.colors.primary }} />
                        <div className="flex-1 rounded p-1.5" style={{ backgroundColor: t.colors.card }}>
                          <div className="mb-1 h-1 w-full rounded-sm" style={{ backgroundColor: t.colors.muted }} />
                          <div className="mb-1 h-1 w-3/4 rounded-sm" style={{ backgroundColor: t.colors.muted }} />
                          <div className="h-1 w-1/2 rounded-sm" style={{ backgroundColor: t.colors.muted }} />
                        </div>
                        <div className="h-2.5 w-10 rounded-sm" style={{ backgroundColor: t.colors.primary }} />
                      </div>
                    )}
                  </div>
                  <div
                    className={cn(
                      "px-3 py-2 text-center text-xs font-medium",
                      isSelected ? "bg-accent text-accent-foreground" : "bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {t.label}
                  </div>
                  {isSelected ? (
                    <div className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </div>
                  ) : null}
                </button>
              );
            })}
            <button
              type="button"
              disabled
              className="relative flex cursor-not-allowed flex-col overflow-hidden rounded-lg opacity-50 transition-all"
            >
              <div className="aspect-[4/3] p-2" style={{ background: "#71717a" }}>
                <div className="flex h-full flex-col gap-1">
                  <div className="h-1.5 w-8 rounded-sm bg-white/60" />
                  <div className="flex-1 rounded bg-white/10 p-1.5">
                    <div className="mb-1 h-1 w-full rounded-sm bg-white/20" />
                    <div className="mb-1 h-1 w-3/4 rounded-sm bg-white/20" />
                    <div className="h-1 w-1/2 rounded-sm bg-white/20" />
                  </div>
                  <div className="h-2.5 w-10 rounded-sm bg-white/60" />
                </div>
              </div>
              <div className="bg-muted/50 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                Custom
              </div>
            </button>
          </div>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>Interface</SettingsSectionTitle>
        <SettingsSectionDescription>Customize the user interface</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Compact Mode"
              description="Reduce spacing for more content"
            />
            <SettingsRowControl>
              <Switch disabled />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title="Sidebar collapsed by default"
              description="Start with the sidebar minimized"
            />
            <SettingsRowControl>
              <Switch disabled />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title="Reduce motion"
              description="Minimize animations for accessibility"
            />
            <SettingsRowControl>
              <Switch disabled />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>
    </SettingsPageBody>
  );
}
