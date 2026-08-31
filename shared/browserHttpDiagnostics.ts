import type { BrowserHttpDiagnostic } from "./browserSurfaceTypes";

interface BrowserHttpResponseDiagnosticInput {
  readonly url: string;
  readonly statusCode: number;
  readonly statusText: string;
  readonly blank: boolean;
}

export function browserHttpDiagnosticForResponse(
  input: BrowserHttpResponseDiagnosticInput,
): BrowserHttpDiagnostic | null {
  if (input.statusCode < 400 || !input.blank) return null;
  return {
    url: input.url,
    statusCode: input.statusCode,
    statusText: input.statusText,
    blank: true,
  };
}
