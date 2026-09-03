# Settings feature

This feature owns personal and project settings, settings chrome, drawer/sidebar navigation, external-tool preferences, and settings-domain state.

The personal settings implementations live at the feature root (`Account.tsx`, `Appearance.tsx`, `Organizations.tsx`, and `Tooling.tsx`) so their pre-existing relative application imports remain valid. `pages/` supplies route-compatible facades plus the project settings surface. `ui/` contains settings-specific chrome and navigation; `model/` contains settings state and preferences.

Historical modules under `src/pages/settings`, `src/components/settings`, project-nested settings paths, and `src/stores` remain compatibility facades only.
