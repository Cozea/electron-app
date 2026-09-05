import type { ProviderAuthState } from "@shared/assistant-contracts/providerSetup";
export function googleAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
    throw new Error("The provider returned an unsupported sign-in URL.");
  }
  return url.href;
}
/** Only a user-started flow may open a browser, including notifications that race its reply. */
export function createProviderAuthBrowserFlow(open: (url: string) => Promise<unknown>) {
  let initiated: string | null = null;
  let opened: string | null = null;
  const observe = async (state: ProviderAuthState): Promise<void> => {
    if (
      !state.authorizationUrl ||
      !state.flowId ||
      initiated !== state.flowId ||
      opened === state.flowId
    )
      return;
    const url = googleAuthorizationUrl(state.authorizationUrl);
    opened = state.flowId;
    try {
      await open(url);
    } catch {
      throw new Error("Could not open Google sign-in. Use Open sign-in again.");
    }
  };
  return {
    observe,
    begin: (state: ProviderAuthState) => {
      initiated = state.flowId;
      return observe(state);
    },
  };
}
