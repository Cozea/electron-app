import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

export function setT3CutoverActive(next: boolean): void {
  if (active === next) {
    return;
  }
  active = next;
  for (const listener of listeners) {
    listener();
  }
}

export function readT3CutoverActive(): boolean {
  return active;
}

export function subscribeT3CutoverActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useT3CutoverActive(): boolean {
  return useSyncExternalStore(subscribeT3CutoverActive, readT3CutoverActive, () => false);
}
