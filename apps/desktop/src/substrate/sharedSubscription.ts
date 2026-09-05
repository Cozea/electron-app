/** One subscription per authority key, released when its final view leaves. */
export function createSharedSubscriptionRegistry() {
  const owners = new Map<string, { references: number; stop: () => void }>();
  return (key: string, start: () => () => void): (() => void) => {
    let owner = owners.get(key);
    if (!owner) {
      owner = { references: 0, stop: start() };
      owners.set(key, owner);
    }
    ++owner.references;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--owner.references === 0) {
        owners.delete(key);
        owner.stop();
      }
    };
  };
}
