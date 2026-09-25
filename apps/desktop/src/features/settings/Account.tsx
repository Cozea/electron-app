import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "../../contexts/AuthContext";
import { DeviceAvatar } from "@/components/ui/DeviceAvatar";
import { AvatarUploader } from "@/components/ui/avatar-uploader";
import {
  SettingsDangerGroup,
  SettingsFooterActions,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "@/features/settings/ui/SettingsChrome";
import { PublicIdDisclosure } from "@/features/settings/ui/PublicIdDisclosure";
import { optimizeProjectDevAppLogo } from "@/features/devapps/projectDevAppLogo";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useTranslation } from "@/lib/i18n";
import { clearDeviceSession } from "@/lib/deviceSession";
import { cn } from "@/lib/utils";

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon as __AlertTriangleHugeIcon,
  Camera01Icon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons'

interface UserPrefs {
  pushNotifications: boolean;
}

interface AccountProps {
  surface?: "page" | "drawer";
  route?: string;
}

export function Account({ surface = "page", route: _route }: AccountProps) {
  const { user, principalId, preferences, refreshToken } = useAuth();
  const { t } = useTranslation();

  const updatePreferencesMutation = useMutation(api.devicePrincipals.updatePreferences);
  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation);
  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar);
  const removeAvatarMutation = useMutation(api.devicePrincipals.removeAvatar);
  const revokeCurrentDevice = useMutation(api.devicePrincipals.revokeCurrentDevice);

  const initialDisplayName = user?.displayName ?? "";
  const initialAvatarUrl = user?.avatarUrl ?? null;

  const [userPrefs, setUserPrefs] = useState<UserPrefs>({ pushNotifications: true });
  const [deviceName, setDeviceName] = useState(() => initialDisplayName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => initialAvatarUrl);
  const [pendingAvatarDataUrl, setPendingAvatarDataUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [savedDeviceName, setSavedDeviceName] = useState(() => initialDisplayName);
  const [savingPresentation, setSavingPresentation] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [presentationError, setPresentationError] = useState<string | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  useEffect(() => {
    if (preferences?.pushNotifications !== undefined) {
      setUserPrefs({ pushNotifications: preferences.pushNotifications });
    }
  }, [preferences?.pushNotifications]);

  useEffect(() => {
    if (!user) return;
    setDeviceName((current) => (current && current !== user.displayName ? current : user.displayName || ""));
    setSavedDeviceName(user.displayName || "");
    setAvatarUrl((current) => (current && current !== user.avatarUrl ? current : user.avatarUrl || null));
    setPendingAvatarDataUrl(null);
    setRemoveAvatar(false);
  }, [user?.avatarUrl, user?.displayName]);

  const identityKey = user?.identityKey ?? "";
  const normalizedDeviceName = deviceName.trim()
  const presentationDirty =
    normalizedDeviceName !== savedDeviceName ||
    pendingAvatarDataUrl !== null ||
    removeAvatar

  const handleResetDevice = async () => {
    if (resetConfirmation !== "RESET" || resetting) return;
    setResetting(true);
    try {
      await revokeCurrentDevice({ reason: "local_identity_reset" });
      const result = await window.electronAPI.collab.deleteDeviceIdentity();
      if (!result.success) throw new Error(result.error || "Could not delete the local device identity");
      await clearDeviceSession();
      window.location.reload();
    } finally {
      setResetting(false);
    }
  };

  const handlePrefChange = async (key: keyof UserPrefs, value: boolean) => {
    if (!principalId) return;
    const previous = userPrefs
    const next = { ...userPrefs, [key]: value };
    setUserPrefs(next);
    try {
      await updatePreferencesMutation({ preferences: { [key]: value } });
    } catch (error) {
      setUserPrefs(previous);
      console.error(`Failed to update preference ${key}:`, error);
    }
  };

  const chooseAvatar = async (file: File | null) => {
    if (!file || processingAvatar) return
    setProcessingAvatar(true)
    setPresentationError(null)
    try {
      const dataUrl = await optimizeProjectDevAppLogo(file)
      setPendingAvatarDataUrl(dataUrl)
      setAvatarUrl(dataUrl)
      setRemoveAvatar(false)
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : "Could not prepare this image")
    } finally {
      setProcessingAvatar(false)
    }
  }

  const savePresentation = async () => {
    if (!principalId || !normalizedDeviceName || savingPresentation || processingAvatar) return
    setSavingPresentation(true)
    setPresentationError(null)
    try {
      await updateDevicePresentation({ displayName: normalizedDeviceName })
      if (removeAvatar) {
        await removeAvatarMutation({})
      } else if (pendingAvatarDataUrl) {
        const bytes = await fetch(pendingAvatarDataUrl).then((response) => response.arrayBuffer())
        await uploadAvatar({ bytes })
      }
      const status = await refreshToken()
      if (status !== 'refreshed') throw new Error('Saved, but the local device session could not refresh')
      setSavedDeviceName(normalizedDeviceName)
      setPendingAvatarDataUrl(null)
      setRemoveAvatar(false)
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : "Could not update this device")
    } finally {
      setSavingPresentation(false)
    }
  }

  const isProfileLoading = !user;

  return (
    <SettingsPageBody surface={surface}>
      <SettingsPageHeader title={t("settings.account.deviceIdentity")} />

      <section>
        <SettingsSectionTitle>Device presentation</SettingsSectionTitle>
        <SettingsSectionDescription>
          Visible device profile shown to collaborators.
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Photo"
              description="Click to upload and crop an avatar"
            />
            <SettingsRowControl>
              <div className="relative group shrink-0">
                <AvatarUploader onUpload={chooseAvatar}>
                  <button
                    type="button"
                    className="relative size-12 rounded-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all active:scale-95 cursor-pointer shadow-xs"
                    disabled={isProfileLoading || savingPresentation || processingAvatar}
                    aria-label={avatarUrl ? "Change avatar" : "Add avatar"}
                    title={avatarUrl ? "Change photo" : "Add photo"}
                  >
                    <DeviceAvatar
                      displayName={normalizedDeviceName || "Device"}
                      avatarUrl={avatarUrl}
                      useColor={false}
                      className="size-full"
                      fallbackClassName="text-base font-bold"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white rounded-full">
                      <HugeiconsIcon icon={Camera01Icon} className="size-4" />
                    </div>
                  </button>
                </AvatarUploader>
                {avatarUrl ? (
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground shadow-xs transition-colors cursor-pointer"
                    onClick={() => {
                      setAvatarUrl(null)
                      setPendingAvatarDataUrl(null)
                      setRemoveAvatar(true)
                    }}
                    title="Remove avatar"
                    aria-label="Remove avatar"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </button>
                ) : (
                  <div className="pointer-events-none absolute -bottom-1 -right-1 flex size-4.5 items-center justify-center rounded-full border border-background bg-secondary text-secondary-foreground shadow-xs group-hover:scale-105 transition-transform">
                    <HugeiconsIcon icon={Camera01Icon} className="size-2.5" />
                  </div>
                )}
              </div>
            </SettingsRowControl>
          </SettingsRow>

          <SettingsRow>
            <SettingsRowLabel
              title="Device name"
              description="How this device appears to collaborators"
              htmlFor="device-display-name"
            />
            <SettingsRowControl>
              <Input
                id="device-display-name"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={80}
                disabled={isProfileLoading || savingPresentation}
                placeholder="My MacBook"
                className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
              />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>

        {presentationError ? (
          <p className="mt-2 text-xs text-destructive px-1" role="alert">{presentationError}</p>
        ) : null}

        {presentationDirty ? (
          <SettingsFooterActions>
            <Button
              type="button"
              size="sm"
              className="h-8 px-4 text-sm font-medium cursor-pointer"
              disabled={!normalizedDeviceName || processingAvatar || savingPresentation}
              onClick={() => void savePresentation()}
            >
              {savingPresentation ? "Saving…" : "Save changes"}
            </Button>
          </SettingsFooterActions>
        ) : null}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <SettingsSectionTitle className="mb-0">{t("settings.account.deviceIdentity")}</SettingsSectionTitle>
        </div>
        <SettingsSectionDescription>
          Cryptographic identity for device pairing and access.
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst className="items-center">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">{t("settings.account.thisDevice")}</span>
              <PublicIdDisclosure value={identityKey} label={t("settings.account.deviceIdentity")} className="max-w-[42rem]" />
            </div>
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
              <Button
                variant="destructive"
                size="sm"
                className="h-7 gap-1.5 text-caption"
                onClick={() => setResetDialogOpen(true)}
              >
                {t("settings.account.resetAction")}
              </Button>
              <ConfirmModal
                kind="destructive-confirm"
                open={resetDialogOpen}
                onOpenChange={setResetDialogOpen}
                title={t("settings.account.resetConfirmTitle")}
                message={t("settings.account.resetConfirmDesc")}
                confirmLabel={t("settings.account.resetDeviceIdentity")}
                cancelLabel={t("common.cancel")}
                onConfirm={() => void handleResetDevice()}
                isConfirming={resetting}
                confirmDisabled={resetConfirmation !== "RESET"}
              >
                <Input
                  placeholder={t("settings.account.resetConfirmLabel")}
                  aria-label={t("settings.account.resetConfirmLabel")}
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  disabled={resetting}
                />
              </ConfirmModal>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsDangerGroup>
      </section>
    </SettingsPageBody>
  );
}
