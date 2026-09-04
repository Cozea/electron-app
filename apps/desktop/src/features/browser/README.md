# Browser feature

Owns embedded browser surfaces, preview navigation, viewport controls, annotations, recording, and renderer-side browser state.

Workbench files may embed this capability, but browser lifecycle and presentation belong here. New imports should use `@/features/browser/...`; the previous project-nested path is temporary compatibility only.
