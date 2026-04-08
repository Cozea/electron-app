import { type ReactNode, useMemo } from "react";

import { AppShellLayout } from "@/components/layouts/AppShellLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useScopedSettingsPage } from "@/hooks/useScopedSettingsPage";
import { getSettingsSurfaceDisplayLabel, getSettingsSurface } from "@/lib/settings/settingsRegistry";
import type { SettingsSurfaceId } from "@/lib/settings/settingsSurfaceTypes";

interface SettingsRouteShellProps {
  children: ReactNode;
  surfaceId: SettingsSurfaceId;
  route?: string;
  header?: ReactNode;
}

export function SettingsRouteShell({
  children,
  surfaceId,
  route,
  header,
}: SettingsRouteShellProps) {
  const { user, logout } = useAuth();
  const settingsPage = useScopedSettingsPage({
    route,
    surfaceId,
  });
  const surface = getSettingsSurface(surfaceId);
  const title = surface
    ? getSettingsSurfaceDisplayLabel(surface, settingsPage.scopeKind)
    : "Settings";
  const resolvedHeader = useMemo(() => {
    const titleNode = <div className="truncate text-sm font-medium">{title}</div>;
    if (!header) {
      return titleNode;
    }

    return (
      <div className="flex min-w-0 items-center gap-2">
        {titleNode}
        <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">{header}</div>
      </div>
    );
  }, [header, title]);

  return (
    <AppShellLayout user={user} onLogout={logout} header={resolvedHeader} contentMode="fixed">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">{children}</div>
    </AppShellLayout>
  );
}
