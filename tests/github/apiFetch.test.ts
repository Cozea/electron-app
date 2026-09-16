import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, requestGitHubJson } from "../../shared/github/apiFetch";

/**
 * Two of the four callers of GitHub's API sent a bearer token while following
 * redirects, with no deadline and no ceiling on what they read. These pin the
 * properties that made the other two safe, so the shared path cannot quietly
 * lose them.
 */
function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("requestGitHubJson", () => {
  it("refuses to follow a redirect, so a token cannot reach another host", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;

    await requestGitHubJson("https://api.github.com/repos/team/app", {
      token: "secret-token",
      fetchFn,
    });

    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("error");
  });

  it("carries a deadline", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;

    await requestGitHubJson("https://api.github.com/x", { fetchFn, timeoutMs: 1234 });

    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the token only when given one", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const headersOf = (index: number) =>
      ((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[index]![1] as RequestInit)
        .headers as Record<string, string>;

    await requestGitHubJson("https://api.github.com/x", { fetchFn });
    expect(headersOf(0).authorization).toBeUndefined();

    await requestGitHubJson("https://api.github.com/x", { fetchFn, token: "secret-token" });
    expect(headersOf(1).authorization).toBe("Bearer secret-token");
  });

  it("never repeats the token in an error", async () => {
    // The transport failure carries the request, and the request carries the
    // token; a message built from the cause would leak it into logs.
    const fetchFn = (async () => {
      throw new Error("connect failed for Bearer secret-token");
    }) as unknown as typeof fetch;

    await expect(
      requestGitHubJson("https://api.github.com/x", { token: "secret-token", fetchFn }),
    ).rejects.toThrow(GitHubApiError);
    await expect(
      requestGitHubJson("https://api.github.com/x", { token: "secret-token", fetchFn }),
    ).rejects.not.toThrow(/secret-token/);
  });

  it("stops reading once the answer exceeds its ceiling", async () => {
    const oversized = "x".repeat(4096);
    const fetchFn = (async () =>
      new Response(JSON.stringify({ oversized }), { status: 200 })) as unknown as typeof fetch;

    await expect(
      requestGitHubJson("https://api.github.com/x", { fetchFn, maxBytes: 128 }),
    ).rejects.toThrow(/exceeded 128 bytes/);
  });

  it("reports the status of a refusal without the body", async () => {
    const fetchFn = (async () =>
      new Response("token=secret-token leaked in body", { status: 403 })) as unknown as typeof fetch;

    const error = await requestGitHubJson("https://api.github.com/x", { fetchFn }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(403);
    expect((error as GitHubApiError).message).not.toContain("secret-token");
  });

  it("reads an answer split across chunk boundaries without corrupting it", async () => {
    // A multi-byte character split across chunks is decoded wrongly if each
    // chunk is decoded on its own.
    const payload = new TextEncoder().encode(JSON.stringify({ name: "café-über" }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload.slice(0, 12));
        controller.enqueue(payload.slice(12));
        controller.close();
      },
    });
    const fetchFn = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

    await expect(requestGitHubJson("https://api.github.com/x", { fetchFn })).resolves.toEqual({
      name: "café-über",
    });
  });

  it("returns nothing for an empty answer, as a dispatch gives", async () => {
    const fetchFn = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await expect(requestGitHubJson("https://api.github.com/x", { fetchFn })).resolves.toBeNull();
  });

  it("posts a JSON body and says so", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await requestGitHubJson("https://api.github.com/x", { fetchFn, body: { event_type: "build" } });

    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("event_type");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
});
