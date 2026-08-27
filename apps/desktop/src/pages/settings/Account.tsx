import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "../../contexts/AuthContext";
import {

  SettingsDangerGroup,
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { useTranslation } from "@/lib/i18n";

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Delete02Icon as __Trash2HugeIcon } from '@hugeicons/core-free-icons'

interface UserPrefs {
  emailNotifications: boolean;
  pushNotifications: boolean;
}

interface AccountProps {
  surface?: "page" | "drawer";
  route?: string;
}

export function Account({ surface = "page", route: _route }: AccountProps) {
  const { user, convexUserId } = useAuth();
  const { t } = useTranslation();

  const profile = useQuery(api.users.getById, convexUserId ? { userId: convexUserId } : "skip");

  const updatePreferencesMutation = useMutation(api.users.updatePreferences);

  const [userPrefs, setUserPrefs] = useState<UserPrefs>({
    emailNotifications: true,
    pushNotifications: true,
  });

  useEffect(() => {
    if (!profile) return;

    setUserPrefs({
      emailNotifications: profile.preferences?.emailNotifications ?? true,
      pushNotifications: profile.preferences?.pushNotifications ?? true,
    });
  }, [profile]);

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ""}`.trim()
    : user?.firstName
      ? `${user.firstName} ${user.lastName || ""}`.trim()
      : user?.email?.split("@")[0] || t("common.user");
  const isLocalDeviceProfile = Boolean(
    user?.email?.trim().toLowerCase().endsWith("@local.cozea.app"),
  );

  const handlePrefChange = async (key: keyof UserPrefs, value: boolean | string) => {
    if (!convexUserId) return;

    const newPrefs = { ...userPrefs, [key]: value };
    setUserPrefs(newPrefs);

    try {
      await updatePreferencesMutation({
        userId: convexUserId,
        preferences: { [key]: value },
      });
    } catch (error) {
      setUserPrefs(userPrefs);
      console.error(`Failed to update preference ${key}:`, error);
    }
  };

  const isProfileLoading = profile === undefined;

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>{isLocalDeviceProfile ? t("settings.account.deviceProfileTitle") : t("settings.account.profileTitle")}</SettingsSectionTitle>
        <SettingsGroup>
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
              {profile?.jobTitle ? (
                <p className="truncate text-[11px] text-muted-foreground">{profile.jobTitle}</p>
              ) : null}
              <p className="truncate text-[11px] text-muted-foreground">
                {isLocalDeviceProfile ? t("settings.account.localTrustedDevice") : user?.email}
              </p>
            </div>
          </div>
        </SettingsGroup>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <SettingsSectionTitle className="mb-0">{t("settings.account.myDevices")}</SettingsSectionTitle>
          <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" disabled>
            {t("settings.account.addDevice")}
          </Button>
        </div>
        <SettingsSectionDescription>
          {t("settings.account.devicesDescription")}
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst className="items-center">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground">{t("settings.account.thisDevice")}</span>
              <p className="text-[11px] text-muted-foreground">{t("settings.account.activeNow")}</p>
            </div>
            <SettingsRowControl>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground" disabled>
                {t("common.revoke")}
              </Button>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.account.notifications")}</SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title={t("settings.account.emailNotifications")}
              description={t("settings.account.emailNotificationsDesc")}
            />
            <SettingsRowControl>
              <Switch
                checked={userPrefs.emailNotifications}
                onCheckedChange={(checked) => void handlePrefChange("emailNotifications", checked)}
                disabled={isProfileLoading}
              />
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title={t("settings.account.pushNotifications")}
              description={t("settings.account.pushNotificationsDesc")}
            />
            <SettingsRowControl>
              <Switch
                checked={userPrefs.pushNotifications}
                onCheckedChange={(checked) => void handlePrefChange("pushNotifications", checked)}
                disabled={isProfileLoading}
              />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle variant="danger">
          <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="size-3.5" aria-hidden />
          {isLocalDeviceProfile ? t("settings.account.localDeviceControls") : t("settings.account.dangerZone")}
        </SettingsSectionTitle>
        <SettingsDangerGroup>
          <SettingsRow isFirst borderClassName="border-destructive/20">
            <SettingsRowLabel
              title={isLocalDeviceProfile ? t("settings.account.resetDeviceIdentity") : t("settings.account.deleteAccount")}
              description={
                isLocalDeviceProfile
                  ? t("settings.account.resetDeviceDesc")
                  : t("settings.account.deleteAccountDesc")
              }
            />
            <SettingsRowControl>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-7 gap-1.5 text-[11px]" disabled>
                    <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                    {t("common.delete")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {isLocalDeviceProfile ? t("settings.account.resetConfirmTitle") : t("settings.account.deleteConfirmTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {isLocalDeviceProfile
                        ? t("settings.account.resetConfirmDesc")
                        : t("settings.account.deleteConfirmDesc")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        {isLocalDeviceProfile
                          ? t("settings.account.resetConfirmLabel")
                          : t("settings.account.deleteConfirmLabel")}
                      </Label>
                      <Input
                        placeholder={isLocalDeviceProfile ? t("settings.account.resetConfirmPlaceholder") : t("settings.account.deleteConfirmPlaceholder")}
                        disabled={isLocalDeviceProfile}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline">{t("common.cancel")}</Button>
                    <Button variant="destructive">{t("settings.account.deleteAccount")}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsDangerGroup>
      </section>
    </SettingsPageBody>
  );
}
