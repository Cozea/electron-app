import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "../../contexts/AuthContext";
import { Avatar } from "@/components/ui/avatar";
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
import { cn } from "@/lib/utils";

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon as __AlertTriangleHugeIcon,
  Camera01Icon,
  Cancel01Icon,
  Delete02Icon as __Trash2HugeIcon,
} from '@hugeicons/core-free-icons'

interface UserPrefs {
  pushNotifications: boolean;
}

interface AccountProps {
  surface?: "page" | "drawer";
  route?: string;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "D"
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "D"
}

export function Account({ surface = "page", route: _route }: AccountProps) {
  const { user, principalId, refreshToken } = useAuth();
  const { t } = useTranslation();
  const profile = useQuery(api.devicePrincipals.getCurrent, principalId ? {} : "skip");

  const updatePreferencesMutation = useMutation(api.devicePrincipals.updatePreferences);
  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation);
  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar);
  const removeAvatarMutation = useMutation(api.devicePrincipals.removeAvatar);
  const revokeCurrentDevice = useMutation(api.devicePrincipals.revokeCurrentDevice);

  const [userPrefs, setUserPrefs] = useState<UserPrefs>({ pushNotifications: true });
  const [deviceName, setDeviceName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [pendingAvatarDataUrl, setPendingAvatarDataUrl] = useState<string | null>(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [savedDeviceName, setSavedDeviceName] = useState("")
  const [savingPresentation, setSavingPresentation] = useState(false)
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [presentationError, setPresentationError] = useState<string | null>(null)
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setUserPrefs({ pushNotifications: profile.preferences?.pushNotifications ?? true });
    setDeviceName(profile.displayName)
    setSavedDeviceName(profile.displayName)
    setAvatarUrl(profile.avatarUrl)
    setPendingAvatarDataUrl(null)
    setRemoveAvatar(false)
  }, [profile]);

  const identityKey = profile?.identityKey ?? user?.identityKey ?? "";
  const normalizedDeviceName = deviceName.trim()
  const presentationDirty =
    normalizedDeviceName !== savedDeviceName ||
    pendingAvatarDataUrl !== null ||
    removeAvatar

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

  const isProfileLoading = profile === undefined;

  return (
    <SettingsPageBody surface={surface}>
      <SettingsPageHeader title="Device Identity" />

      <section>
        <SettingsSectionTitle>Device presentation</SettingsSectionTitle>
        <SettingsSectionDescription>
          This name and avatar identify this physical Cozea device to collaborators. They do not affect its cryptographic identity or access.
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
                    className="relative size-12 rounded-2xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all active:scale-95 cursor-pointer shadow-xs"
                    disabled={isProfileLoading || savingPresentation || processingAvatar}
                    aria-label={avatarUrl ? "Change avatar" : "Add avatar"}
                    title={avatarUrl ? "Change photo" : "Add photo"}
                  >
                    <Avatar className="size-full rounded-2xl">
                      {avatarUrl ? (
                        <Avatar.Image src={avatarUrl} alt={normalizedDeviceName || "This device"} />
                      ) : null}
                      <Avatar.Fallback className="text-base font-bold">
                        {initials(normalizedDeviceName || "Device")}
                      </Avatar.Fallback>
                    </Avatar>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white rounded-2xl">
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
          <p className="mt-2 text-[11px] text-destructive px-1" role="alert">{presentationError}</p>
        ) : null}

        {presentationDirty ? (
          <SettingsFooterActions>
            <Button
              type="button"
              size="sm"
              className="h-8 px-4 text-xs font-medium cursor-pointer"
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
          The public device ID is stable for this cryptographic identity. Changing the name or avatar above does not change this ID.
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst className="items-center">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground">{t("settings.account.thisDevice")}</span>
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
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-7 gap-1.5 text-[11px]">
                    <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                    {t("common.delete")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("settings.account.resetConfirmTitle")}</DialogTitle>
                    <DialogDescription>{t("settings.account.resetConfirmDesc")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label>{t("settings.account.resetConfirmLabel")}</Label>
                    <Input
                      placeholder={t("settings.account.resetConfirmPlaceholder")}
                      value={resetConfirmation}
                      onChange={(event) => setResetConfirmation(event.target.value)}
                      disabled={resetting}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline">{t("common.cancel")}</Button>
                    <Button
                      variant="destructive"
                      disabled={resetConfirmation !== "RESET" || resetting}
                      onClick={() => void (async () => {
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
                      })()}
                    >
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
