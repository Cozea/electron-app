import { describe, expect, it } from "vitest";

import { withWorkspaceBindingLock } from "@/features/workbench/assistant/workbenchAssistantShared";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("workspace assistant binding serialization", () => {
  it("lets the replacement effect reconcile a committed project after its predecessor is cancelled", async () => {
    const creating = deferred();
    const committed = deferred();
    let cancelled = false;
    let projectExists = false;
    let creates = 0;
    let bound = false;
    const first = withWorkspaceBindingLock("/binding-cancelled", async () => {
      creates += 1;
      creating.resolve();
      await committed.promise;
      projectExists = true;
      if (!cancelled) bound = true;
    });
    await creating.promise;
    cancelled = true;
    const replacement = withWorkspaceBindingLock("/binding-cancelled", async () => {
      if (!projectExists) creates += 1;
      bound = true;
    });
    expect(bound).toBe(false);
    committed.resolve();
    await Promise.all([first, replacement]);
    expect(creates).toBe(1);
    expect(bound).toBe(true);
  });

  it("releases a failed attempt and keeps another workspace independent", async () => {
    const started = deferred();
    const release = deferred();
    const failed = withWorkspaceBindingLock("/binding-failure", async () => {
      started.resolve();
      await release.promise;
      throw new Error("snapshot unavailable");
    });
    const failure = expect(failed).rejects.toThrow("snapshot unavailable");
    await started.promise;
    let replacementRan = false;
    const replacement = withWorkspaceBindingLock("/binding-failure", async () => {
      replacementRan = true;
    });
    await expect(withWorkspaceBindingLock("/binding-other", async () => "ready")).resolves.toBe(
      "ready",
    );
    expect(replacementRan).toBe(false);
    release.resolve();
    await Promise.all([failure, replacement]);
    expect(replacementRan).toBe(true);
  });
});
