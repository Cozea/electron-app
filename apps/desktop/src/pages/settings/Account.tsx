import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "../../contexts/AuthContext";
import {
  SettingsDangerGroup,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
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
import { clearDeviceSession } from "@/lib/deviceSession";

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Delete02Icon as __Trash2HugeIcon } from '@hugeicons/core-free-icons'

interface UserPrefs {
  pushNotifications: boolean;
}

interface AccountProps {
  surface?: "page" | "drawer";
  route?: string;
}

export function Account({ surface = "page", route: _route }: AccountProps) {
  const { user, convexUserId } = useAuth();
  const { t } = useTranslation();

  const profile = useQuery(api.users.getCurrent, convexUserId ? {} : "skip");

  const updatePreferencesMutation = useMutation(api.users.updatePreferences);
  const revokeCurrentDevice = useMutation(api.users.revokeCurrentDevice);

  const [userPrefs, setUserPrefs] = useState<UserPrefs>({
    pushNotifications: true,
  });
  const [copied, setCopied] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!profile) return;

    setUserPrefs({
      pushNotifications: profile.preferences?.pushNotifications ?? true,
    });
  }, [profile]);

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ""}`.trim()
    : user?.firstName
      ? `${user.firstName} ${user.lastName || ""}`.trim()
      : t("settings.account.thisDevice");
  const identityKey = profile?.identityKey ?? user?.deviceId ?? user?.id ?? "";

  const copyIdentityKey = async () => {
    if (!identityKey) return;
    await navigator.clipboard.writeText(identityKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const handlePrefChange = async (key: keyof UserPrefs, value: boolean) => {
    if (!convexUserId) return;

    const newPrefs = { ...userPrefs, [key]: value };
    setUserPrefs(newPrefs);

    try {
      await updatePreferencesMutation({
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
      <SettingsPageHeader title={t("settings.nav.account")} />
      <section>
        <SettingsSectionTitle>{t("settings.account.deviceProfileTitle")}</SettingsSectionTitle>
        <SettingsGroup>
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
              {profile?.jobTitle ? (
                <p className="truncate text-[11px] text-muted-foreground">{profile.jobTitle}</p>
              ) : null}
              <p className="truncate text-[11px] text-muted-foreground">
                {t("settings.account.localTrustedDevice")}
              </p>
            </div>
          </div>
        </SettingsGroup>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <SettingsSectionTitle className="mb-0">{t("settings.account.deviceIdentity")}</SettingsSectionTitle>
        </div>
        <SettingsSectionDescription>
          {t("settings.account.devicesDescription")}
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst className="items-center">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground">{t("settings.account.thisDevice")}</span>
              <p className="max-w-[34rem] truncate font-mono text-[11px] text-muted-foreground">
                {identityKey || t("common.loading")}
              </p>
            </div>
            <SettingsRowControl>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                disabled={!identityKey}
                onClick={() => void copyIdentityKey()}
              >
                {copied ? t("common.copied") : t("common.copy")}
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
          {t("settings.account.localDeviceControls")}
        </SettingsSectionTitle>
        <SettingsDangerGroup>
          <SettingsRow isFirst borderClassName="border-destructive/20">
            <SettingsRowLabel
              title={t("settings.account.resetDeviceIdentity")}
              description={t("settings.account.resetDeviceDesc")}
            />
            <SettingsRowControl>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-7 gap-1.5 text-[11px]">
                    <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                    {t("common.delete")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {t("settings.account.resetConfirmTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("settings.account.resetConfirmDesc")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        {t("settings.account.resetConfirmLabel")}
                      </Label>
                      <Input
                        placeholder={t("settings.account.resetConfirmPlaceholder")}
                        value={resetConfirmation}
                        onChange={(event) => setResetConfirmation(event.target.value)}
                        disabled={resetting}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline">{t("common.cancel")}</Button>
                    <Button variant="destructive" disabled={resetConfirmation !== "RESET" || resetting}
                      onClick={() => void (async () => {
                        setResetting(true);
                        try {
                          await revokeCurrentDevice({ reason: "local_identity_reset" });
                          const result = await window.electronAPI.collab.deleteDeviceIdentity();
                          if (!result.success) throw new Error(result.error || "Could not delete the local device identity");
                          clearDeviceSession();
                          window.location.reload();
                        } finally {
                          setResetting(false);
                        }
                      })()}>
                      {t("settings.account.resetDeviceIdentity")}
                    </Button>
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
