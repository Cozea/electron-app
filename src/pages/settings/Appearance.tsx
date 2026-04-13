import { CheckIcon as Check } from "@heroicons/react/24/outline"

import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  swatch: string;
}[] = [
  {
    value: "light",
    label: "Light",
    swatch: "#0b0b0f",
  },
  {
    value: "dark",
    label: "Dark",
    swatch: "#2b2b31",
  },
  {
    value: "navy",
    label: "Navy",
    swatch: "#3b82f6",
  },
  {
    value: "wine",
    label: "Wine",
    swatch: "#d64074",
  },
  {
    value: "clay",
    label: "Clay",
    swatch: "#c4956a",
  },
  {
    value: "forest",
    label: "Forest",
    swatch: "#3d7a57",
  },
  {
    value: "system",
    label: "System",
    swatch: "linear-gradient(135deg, #ffffff 0%, #d5d8df 45%, #64748b 55%, #38bdf8 100%)",
  },
];

export function Appearance({ surface = "page", route: _route }: AppearanceProps) {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>Theme</SettingsSectionTitle>
        <SettingsSectionDescription>Choose your preferred color scheme</SettingsSectionDescription>
        <TooltipProvider>
          <div className="overflow-x-auto px-1 py-1">
            <div className="flex min-w-max items-center gap-3">
              {themes.map((t) => {
                const isSelected = theme === t.value;

                return (
                  <Tooltip key={t.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setTheme(t.value)}
                        aria-label={t.label}
                        className={cn(
                          "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/70 transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          "hover:scale-[1.03] hover:border-border",
                          isSelected && "border-foreground/10 ring-2 ring-foreground/30 ring-offset-2 ring-offset-background",
                        )}
                        style={{ background: t.swatch }}
                      >
                        {isSelected ? (
                          <Check className="h-5 w-5 text-white drop-shadow-sm" />
                        ) : null}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </TooltipProvider>
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
