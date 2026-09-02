# Settings feature

Owns renderer settings navigation, settings-domain preferences, and settings surfaces.

- `model/settingsDrawerStore.ts`: drawer route and section state.
- `model/editorPreferences.ts`: preferred external editor selection and persistence.

Settings pages and shared settings chrome are migrated here in a later structural stage. Historical store modules remain compatibility facades.
