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
export function patchT3ServerBundleProviderUpdates(source: string): {
  source: string;
  changed: boolean;
};

export function isCurrentT3Bundle(validBundle: boolean, stamp: string | null, sourceStamp: string): boolean;
export function patchT3ServerBundleMediaContainment(source: string): {
  source: string;
  changed: boolean;
};
export function patchT3ComputerUseSource(options?: {
  checkOnly?: boolean;
  sourcePath?: string;
}): boolean;
export function patchT3ServerBundleComputerUse(source: string): {
  source: string;
  changed: boolean;
};
