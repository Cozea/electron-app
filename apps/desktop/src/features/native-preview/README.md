# Native preview feature

Owns native simulator preview surfaces, simulator selection, session state, and iOS preview lifecycle coordination.

- `hooks/useIosNativePreview.ts`: renderer orchestration for iOS preview sessions.
- `model/nativePreviewStore.ts`: canonical native-preview renderer state.
- root files: preview surfaces and presentation.

Workbench may host these views, while native-preview behavior remains feature-owned.
