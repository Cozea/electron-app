import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const authContext = source("apps/desktop/src/contexts/AuthContext.tsx");
const presence = source("apps/desktop/src/hooks/useProjectPresence.ts");
const safeQuery = source("apps/desktop/src/hooks/useSafeConvexQuery.ts");
const projectLayout = source("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx");
const shareButton = source(
  "apps/desktop/src/components/layouts/unified-header/HeaderProjectShareButton.tsx",
);
const authenticatedFunctions = source("convex/lib/authenticatedFunctions.ts");
const presenceFunctions = source("convex/projectPresence.ts");

describe("convex auth gating", () => {
  it("still routes presence through the authenticated builder", () => {
    // The whole point of the client-side gate is that the server rejects
    // unauthenticated callers. If this ever becomes a plain `query`, the gate is
    // load-bearing for nothing and this suite is misleading.
    expect(presenceFunctions).toContain("authenticatedQuery as query");
    expect(authenticatedFunctions).toContain("await requireAuthenticatedDevice(ctx)");
  });

  it("exposes convex auth readiness as the token, not the cached identity", () => {
    // `isAuthenticated` is painted from the shell-first bootstrap cache long
    // before any cloud call can succeed, so it is the wrong gate for a query.
    expect(authContext).toContain("isConvexAuthReady: Boolean(accessToken)");
    expect(authContext).toContain("isAuthenticated: Boolean(user)");
  });

  it("gates presence on convex auth readiness, not merely on runtime readiness", () => {
    expect(projectLayout).toContain(
      "const presenceGateOpen = runtimeEffectsReady && shouldEnableProjectRuntime && isConvexAuthReady",
    );
    expect(presence).toContain("projectId && isConvexAuthReady ? { projectId } : \"skip\"");
    // The heartbeat mutation shares the gate so a 30s interval cannot turn the
    // auth gap into a steady drip of rejected writes.
    expect(presence).toContain("if (!projectId || !userId || !isConvexAuthReady) return");
  });

  it("keeps presence failures out of the route error boundary", () => {
    expect(presence).toContain("useSafeConvexQuery");
    expect(presence).not.toMatch(/useQuery\(\s*\n?\s*api\.projectPresence/);
    expect(presence).toContain('activeUsersQuery.status === "loading"');
  });

  it("builds the safe query on useQueries, which returns errors as values", () => {
    // useQuery rethrows during render (`if (result instanceof Error) throw result`),
    // which is exactly the behaviour being avoided here. Strip comments first —
    // the module's own docs quote that snippet.
    const code = safeQuery.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("useQueries");
    expect(code).not.toMatch(/\bthrow\b/);
    expect(code).toContain("result instanceof Error");
  });

  it("keys the safe query's subscription on the function name, not the reference", async () => {
    // The generated `api` object is a proxy that materialises a fresh function
    // reference on every property access. Keying the queries memo on that
    // reference rebuilds the request object every render, so useQueries
    // resubscribes and sets state during render — React then throws
    // "Too many re-renders" and the error boundary eats the view.
    const { anyApi, getFunctionName } = await import("convex/server")
    const api = anyApi as unknown as Record<string, Record<string, never>>

    const first = api.projectPresence.getActiveUsers
    const second = api.projectPresence.getActiveUsers
    expect(first).not.toBe(second)
    expect(getFunctionName(first)).toBe(getFunctionName(second))

    const code = safeQuery.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).toContain("const queryName = getFunctionName(query)")
    expect(code).toContain("[skip, queryName, JSON.stringify(convexToJson(argsObject))]")
  });

  it("gates every authenticated query in the share button on principalId", () => {
    // All share-surface reads require a live authenticated device principal;
    // cached shell presentation alone must never open cloud queries.
    expect(shareButton).toContain(
      'projectId && principalId ? { projectId, userId: principalId } : "skip"',
    );
  });
});
