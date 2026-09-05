import { create } from "zustand";
import type { SubscriptionStatus } from "./subscriptionSupervisor";

export const t3ThreadConnectionKey = (baseUrl: string, threadId: string) =>
  JSON.stringify([baseUrl, threadId]);
export const t3ShellConnectionKey = (baseUrl: string) => JSON.stringify([baseUrl, "shell"]);

export const useT3ConnectionStore = create<{ byOwner: Record<string, SubscriptionStatus> }>(() => ({
  byOwner: {},
}));
export function setT3ConnectionStatus(key: string, status: SubscriptionStatus | null): void {
  useT3ConnectionStore.setState((state) => {
    const byOwner = { ...state.byOwner };
    if (status) byOwner[key] = status;
    else delete byOwner[key];
    return { byOwner };
  });
}
export function useT3ConnectionStatus(key: string | null): SubscriptionStatus | null {
  return useT3ConnectionStore((state) => (key ? (state.byOwner[key] ?? null) : null));
}
