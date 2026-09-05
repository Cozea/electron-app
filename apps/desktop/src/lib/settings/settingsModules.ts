export const settingsModules = {
  account: () => import('@/features/settings/Account'),
  appearance: () => import('@/features/settings/Appearance'),
  devapps: () => import('@/features/settings/DevAppSettings'),
  organizations: () => import('@/features/settings/Organizations'),
  tooling: () => import('@/features/settings/Tooling'),
}
