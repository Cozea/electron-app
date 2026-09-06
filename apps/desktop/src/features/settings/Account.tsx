import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "../../contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Delete02Icon as __Trash2HugeIcon } from '@hugeicons/core-free-icons'

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
  const { user, principalId } = useAuth();
  const { t } = useTranslation();

  const profile = useQuery(api.devicePrincipals.getCurrent, principalId ? {} : "skip");

  const updatePreferencesMutation = useMutation(api.devicePrincipals.updatePreferences);
  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation);
  const revokeCurrentDevice = useMutation(api.devicePrincipals.revokeCurrentDevice);

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [userPrefs, setUserPrefs] = useState<UserPrefs>({
    pushNotifications: true,
  });
  const [deviceName, setDeviceName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [savedDeviceName, setSavedDeviceName] = useState("")
  const [savedAvatarUrl, setSavedAvatarUrl] = useState<string | null>(null)
  const [savingPresentation, setSavingPresentation] = useState(false)
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [presentationError, setPresentationError] = useState<string | null>(null)
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!profile) return;

    setUserPrefs({
      pushNotifications: profile.preferences?.pushNotifications ?? true,
    });

    const nextName = profile.deviceLabel?.trim()
      || profile.firstName?.trim()
      || t("settings.account.thisDevice")
    const nextAvatar = profile.profileImageUrl ?? null
    setDeviceName(nextName)
    setSavedDeviceName(nextName)
    setAvatarUrl(nextAvatar)
    setSavedAvatarUrl(nextAvatar)
  }, [profile, t]);

  const identityKey = profile?.identityKey ?? user?.deviceId ?? user?.id ?? "";
  const normalizedDeviceName = deviceName.trim()
  const presentationDirty = normalizedDeviceName !== savedDeviceName || avatarUrl !== savedAvatarUrl

  const handlePrefChange = async (key: keyof UserPrefs, value: boolean) => {
    if (!principalId) return;

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

  const savePresentation = async () => {
    if (!principalId || !normalizedDeviceName || savingPresentation || processingAvatar) return
    setSavingPresentation(true)
    setPresentationError(null)
    try {
      const result = await updateDevicePresentation({
        displayName: normalizedDeviceName,
        avatarUrl,
      })
      const nextName = result.displayName?.trim() || normalizedDeviceName
      const nextAvatar = result.avatarUrl ?? null
      setDeviceName(nextName)
      setSavedDeviceName(nextName)
      setAvatarUrl(nextAvatar)
      setSavedAvatarUrl(nextAvatar)
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : "Could not update this device")
    } finally {
      setSavingPresentation(false)
    }
  }

  const chooseAvatar = async (file: File | null) => {
    if (!file || processingAvatar) return
    setProcessingAvatar(true)
    setPresentationError(null)
    try {
      // Reuse the existing hardened square-image pipeline for this first slice.
      // The final schema cutover will move principal avatars to Convex Storage
      // and rename/extract this helper away from the DevApp-specific module.
      setAvatarUrl(await optimizeProjectDevAppLogo(file))
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : "Could not prepare this image")
    } finally {
      setProcessingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
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
          <div className="flex items-center gap-4 px-4 py-4">
            <Avatar className="size-12 shrink-0 rounded-xl">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={normalizedDeviceName || "This device"} /> : null}
              <AvatarFallback className="rounded-xl text-sm font-medium">
                {initials(normalizedDeviceName || "Device")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="device-display-name" className="text-xs">Device name</Label>
              <Input
                id="device-display-name"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={80}
                disabled={isProfileLoading || savingPresentation}
                placeholder="My MacBook"
                className="h-8"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(event) => void chooseAvatar(event.currentTarget.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={processingAvatar || savingPresentation}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {processingAvatar ? "Preparing…" : avatarUrl ? "Change avatar" : "Add avatar"}
                </Button>
                {avatarUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={processingAvatar || savingPresentation}
                    onClick={() => setAvatarUrl(null)}
                  >
                    Remove
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto h-7 text-[11px]"
                  disabled={!presentationDirty || !normalizedDeviceName || processingAvatar || savingPresentation}
                  onClick={() => void savePresentation()}
                >
                  {savingPresentation ? "Saving…" : "Save"}
                </Button>
              </div>
              {presentationError ? (
                <p className="text-[11px] text-destructive" role="alert">{presentationError}</p>
              ) : null}
            </div>
          </div>
        </SettingsGroup>
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
              <PublicIdDisclosure
                value={identityKey}
                label={t("settings.account.deviceIdentity")}
                className="max-w-[42rem]"
              />
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
                          await clearDeviceSession();
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
