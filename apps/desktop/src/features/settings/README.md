# Settings feature

Owns renderer settings navigation, external-tool preferences, and settings-domain state.

- `model/settingsDrawerStore.ts`: drawer route and section state.
- `model/editorPreferences.ts`: preferred editor selection.
- `model/externalBrowserPreference.ts`: preferred browser persistence.
- `model/externalEditorPreference.ts`: workbench external-editor preference.

Settings pages and shared settings chrome are migrated here in a later structural stage. Historical modules remain compatibility facades.
