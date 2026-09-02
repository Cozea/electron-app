export function buildVendorSourceStamp(
  expectedPin: string,
  trackedDiff: string,
  untrackedFiles?: ReadonlyArray<{ path: string; contents: string | Uint8Array }>,
): string;
export function sanitizePortableRuntimeSymlinks(runtimeRoot: string): string[];
export function patchT3ServerBundleProviderDefaults(source: string): {
  source: string;
  changed: boolean;
};
