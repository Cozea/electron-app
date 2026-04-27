

import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsNativeSelectClass,
} from "@/components/settings/SettingsChrome";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "../../components/ui/switch";
import { useTheme } from "../../contexts/ThemeContext";
import type { Theme } from "@/lib/theme";
import { cn } from "../../lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useLanguage, useTranslation, LANGUAGES, type Language } from "@/lib/i18n";

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckHugeIcon } from '@hugeicons/core-free-icons'

interface AppearanceProps {
  surface?: "page" | "drawer";
  route?: string;
}

export function Appearance({ surface = "page", route: _route }: AppearanceProps) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const [transparencyOff, setTransparencyOff] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);

  const themes: {
    value: Theme;
    labelKey: "settings.appearance.themeLight" | "settings.appearance.themeDark" | "settings.appearance.themeNavy" | "settings.appearance.themeWine" | "settings.appearance.themeClay" | "settings.appearance.themeForest" | "settings.appearance.themeSystem";
    swatch: string;
  }[] = [
    {
      value: "light",
      labelKey: "settings.appearance.themeLight",
      swatch: "#ffffff",
    },
    {
      value: "dark",
      labelKey: "settings.appearance.themeDark",
      swatch: "#2b2b31",
    },
    {
      value: "navy",
      labelKey: "settings.appearance.themeNavy",
      swatch: "#3b82f6",
    },
    {
      value: "wine",
      labelKey: "settings.appearance.themeWine",
      swatch: "#d64074",
    },
    {
      value: "clay",
      labelKey: "settings.appearance.themeClay",
      swatch: "#c4956a",
    },
    {
      value: "forest",
      labelKey: "settings.appearance.themeForest",
      swatch: "#3d7a57",
    },
    {
      value: "system",
      labelKey: "settings.appearance.themeSystem",
      swatch: "linear-gradient(135deg, #ffffff 0%, #d5d8df 45%, #64748b 55%, #38bdf8 100%)",
    },
  ];

  useEffect(() => {
    void window.electronAPI.settings.get().then((s) => {
      setTransparencyOff(s.deactivateTransparency ?? false);
    });
  }, []);

  const handleTransparencyToggle = useCallback(
    async (checked: boolean) => {
      setTransparencyOff(checked);
      await window.electronAPI.settings.set({ deactivateTransparency: checked });
      setPendingRestart(true);
    },
    [],
  );

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>{t("settings.appearance.language")}</SettingsSectionTitle>
        <SettingsSectionDescription>{t("settings.appearance.languageDesc")}</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title={t("settings.appearance.language")}
              description={t("settings.appearance.languageDesc")}
            />
            <SettingsRowControl>
              <select
                className={settingsNativeSelectClass}
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.appearance.theme")}</SettingsSectionTitle>
        <SettingsSectionDescription>{t("settings.appearance.themeDesc")}</SettingsSectionDescription>
        <TooltipProvider>
          <div className="overflow-x-auto px-1 py-1">
            <div className="flex min-w-max items-center gap-3">
              {themes.map((themeItem) => {
                const isSelected = theme === themeItem.value;

                return (
                  <Tooltip key={themeItem.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setTheme(themeItem.value)}
                        aria-label={t(themeItem.labelKey)}
                        className={cn(
                          "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/70 transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          "hover:scale-[1.03] hover:border-border",
                          isSelected && "border-foreground/10 ring-2 ring-foreground/30 ring-offset-2 ring-offset-background",
                        )}
                        style={{ background: themeItem.swatch }}
                      >
                        {isSelected ? (
                          <HugeiconsIcon icon={__CheckHugeIcon} className="h-5 w-5 text-white drop-shadow-sm" />
                        ) : null}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t(themeItem.labelKey)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </TooltipProvider>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.appearance.interface")}</SettingsSectionTitle>
        <SettingsSectionDescription>{t("settings.appearance.interfaceDesc")}</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title={t("settings.appearance.deactivateTransparency")}
              description={
                pendingRestart
                  ? t("settings.appearance.deactivateTransparencyDescRestart")
                  : t("settings.appearance.deactivateTransparencyDescDefault")
              }
            />
            <SettingsRowControl>
              <Switch
                checked={transparencyOff}
                onCheckedChange={handleTransparencyToggle}
              />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title={t("settings.appearance.compactMode")}
              description={t("settings.appearance.compactModeDesc")}
            />
            <SettingsRowControl>
              <Switch disabled />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title={t("settings.appearance.sidebarCollapsed")}
              description={t("settings.appearance.sidebarCollapsedDesc")}
            />
            <SettingsRowControl>
              <Switch disabled />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title={t("settings.appearance.reduceMotion")}
              description={t("settings.appearance.reduceMotionDesc")}
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
