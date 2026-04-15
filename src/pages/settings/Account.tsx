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
import { Badge } from "../../components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, ArrowMoveUpLeftIcon as __UploadHugeIcon, Delete02Icon as __Trash2HugeIcon, Notification03Icon as __BellHugeIcon } from '@hugeicons/core-free-icons'

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
      : user?.email?.split("@")[0] || "User";
  const avatarImageUrl = profile?.profileImageUrl || user?.profileImageUrl || undefined;

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
        <SettingsSectionTitle>Profile</SettingsSectionTitle>
        <SettingsGroup>
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="group relative h-14 w-14 shrink-0 cursor-pointer">
              <Avatar className="h-14 w-14">
                <AvatarImage src={avatarImageUrl} alt={displayName} />
                <AvatarFallback delayMs={150} className="text-lg">
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center rounded-b-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <HugeiconsIcon icon={__UploadHugeIcon} className="h-3 w-3 text-white" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
              {profile?.jobTitle ? (
                <p className="truncate text-[11px] text-muted-foreground">{profile.jobTitle}</p>
              ) : null}
              <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </SettingsGroup>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <SettingsSectionTitle className="mb-0">Active sessions</SettingsSectionTitle>
          <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" disabled>
            Sign out all
          </Button>
        </div>
        <SettingsSectionDescription>Devices currently signed in to your account</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst className="items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-foreground">Current device</span>
                <Badge variant="secondary" className="text-[10px]">
                  Current
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">Active now</p>
            </div>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>
          <HugeiconsIcon icon={__BellHugeIcon} className="size-3.5" aria-hidden />
          Notifications
        </SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Email notifications"
              description="Receive updates via email"
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
              title="Push notifications"
              description="Receive in-app notifications"
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
          Danger zone
        </SettingsSectionTitle>
        <SettingsDangerGroup>
          <SettingsRow isFirst borderClassName="border-destructive/20">
            <SettingsRowLabel
              title="Delete account"
              description="Permanently delete your account and all data"
            />
            <SettingsRowControl>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-7 gap-1.5 text-[11px]" disabled>
                    <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete account</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. All your data will be permanently deleted.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Type &quot;delete my account&quot; to confirm</Label>
                      <Input placeholder="delete my account" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Delete account</Button>
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
