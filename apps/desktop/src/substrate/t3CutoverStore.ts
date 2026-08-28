import { useSyncExternalStore } from "react";

const activeOwners = new Set<symbol>();
let active = false;
const listeners = new Set<() => void>();

export function setT3CutoverActive(owner: symbol, next: boolean): void {
  if (next) {
    activeOwners.add(owner);
  } else {
    activeOwners.delete(owner);
  }
  const nextActive = activeOwners.size > 0;
  if (active === nextActive) {
    return;
  }
  active = nextActive;
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
