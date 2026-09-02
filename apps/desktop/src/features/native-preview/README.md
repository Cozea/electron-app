# Native preview feature

Owns renderer-side native simulator preview surfaces, native-preview presentation types, simulator selection, and session state.

- `model/nativePreviewStore.ts`: canonical native-preview renderer state.
- root files: preview surfaces and presentation.

The workbench may host these views, while native-preview behavior remains feature-owned. The historical global store module is a compatibility facade.
