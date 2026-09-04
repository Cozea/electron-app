import { isExternallyOpenableBrowserUrl, normalizeUrlInput } from "./urlInput";

interface BrowserAddressDisplayInput {
  readonly committedUrl: string;
  readonly draft: string;
  readonly focused: boolean;
}

export function browserAddressDisplayValue(input: BrowserAddressDisplayInput): string {
  return input.focused ? input.draft : input.committedUrl;
}

export function resolveBrowserAddressSubmission(draft: string): string | null {
  const normalized = normalizeUrlInput(draft);
  return normalized && isExternallyOpenableBrowserUrl(normalized) ? normalized : null;
}
