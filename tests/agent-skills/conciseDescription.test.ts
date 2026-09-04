import { describe, expect, it } from "vitest";

import { conciseDescription, prettifySkillName } from "../../apps/desktop/src/features/projects/pages/AgentSkillsPage";

describe("the one-line description in a library row", () => {
  it("leaves a description that already fits alone", () => {
    expect(conciseDescription("Hydrogen storefront implementation cookbooks.")).toBe(
      "Hydrogen storefront implementation cookbooks.",
    );
    expect(conciseDescription("Create Cursor rules for persistent AI guidance.")).toBe(
      "Create Cursor rules for persistent AI guidance.",
    );
  });

  it("strips inline markdown, which is noise in a list", () => {
    expect(
      conciseDescription("Write or explain **Admin GraphQL** queries and mutations."),
    ).toBe("Write or explain Admin GraphQL queries and mutations.");
    expect(conciseDescription("Run `wrangler deploy` for the worker.")).toBe(
      "Run wrangler deploy for the worker.",
    );
    expect(conciseDescription("See [the docs](https://example.com) first.")).toBe(
      "See the docs first.",
    );
  });

  it("cuts a long sentence at a clause rather than mid-word", () => {
    expect(
      conciseDescription(
        "The Customer Account API allows customers to access their own data including orders, addresses, and payment methods.",
      ),
    ).toBe("The Customer Account API allows customers to access their own data…");
  });

  it("drops a trailing relative clause, which a one-line summary can spare", () => {
    expect(
      conciseDescription(
        "Write or explain **Admin GraphQL** queries and mutations for apps and integrations that need to read or write store data.",
      ),
    ).toBe("Write or explain Admin GraphQL queries and mutations for apps…");
  });

  it("never ends on a dangling connective", () => {
    const result = conciseDescription(
      "Shopify Functions allow developers to customize the backend logic that powers parts of the platform in ways that were previously impossible.",
    );
    expect(result).toBe(
      "Shopify Functions allow developers to customize the backend logic…",
    );
    expect(result).not.toMatch(/\b(that|of|the|to|for|with|in)…$/);
  });

  it("keeps only the first sentence when a paragraph of triggers follows", () => {
    expect(
      conciseDescription(
        "Set a goal that Cursor will pursue to completion. Use when the user says goal, or asks to keep going until done.",
      ),
    ).toBe("Set a goal that Cursor will pursue to completion.");
  });

  it("collapses whitespace from a folded block scalar", () => {
    expect(
      conciseDescription("Keep a PR merge-ready by triaging comments, resolving\n  clear conflicts."),
    ).toBe("Keep a PR merge-ready by triaging comments, resolving clear conflicts.");
  });

  it("says so when there is no description", () => {
    expect(conciseDescription("")).toBe("No description");
    expect(conciseDescription("   ")).toBe("No description");
  });

  it("drops an opening that says when to use the skill rather than what it does", () => {
    expect(
      conciseDescription(
        "Use for any question about a codebase, its architecture, file relationships, or project content.",
      ),
    ).toBe("Any question about a codebase, its architecture, file relationships…");

    expect(
      conciseDescription(
        'This skill should be used when the user asks to "create a hookify rule" or "write a hook rule".',
      ),
    ).toBe('"create a hookify rule" or "write a hook rule".');
  });

  it("keeps the opening when stripping it would leave almost nothing", () => {
    expect(conciseDescription("Use when asked.")).toBe("Use when asked.");
  });

  it("stays within the row's budget, ellipsis included", () => {
    for (const long of [
      `Guides ${"extremely detailed ".repeat(20)}work.`,
      `Generate ${"a".repeat(200)} report.`,
      "Send and receive transactional emails with Cloudflare Email Service (Email Sending plus Email Routing) everywhere.",
    ]) {
      expect(conciseDescription(long).length).toBeLessThanOrEqual(72);
    }
  });
});

/**
 * A skill declares its name as the slug you type to invoke it, so a browsing
 * list full of `cloudflare-email-service` reads as identifiers rather than
 * names. The list titles them and keeps the slug alongside.
 */
describe("titling a skill's declared slug", () => {
  it("title-cases the words of a slug", () => {
    expect(prettifySkillName("cloudflare-email-service")).toBe("Cloudflare Email Service");
    expect(prettifySkillName("autopilot")).toBe("Autopilot");
  });

  it("keeps initialisms upper-case rather than sentence-casing them", () => {
    expect(prettifySkillName("agents-sdk")).toBe("Agents SDK");
    expect(prettifySkillName("web-perf")).toBe("Web Perf");
    expect(prettifySkillName("mcp-server-dev")).toBe("MCP Server Dev");
  });

  it("separates a plugin-qualified name into its two halves", () => {
    expect(prettifySkillName("mcp-server-dev:build-mcp-server")).toBe(
      "MCP Server Dev · Build MCP Server",
    );
    expect(prettifySkillName("discord:access")).toBe("Discord · Access");
  });

  it("keeps joining words lower-case unless they open the title", () => {
    expect(prettifySkillName("building-ai-agent-on-cloudflare")).toBe(
      "Building AI Agent on Cloudflare",
    );
    expect(prettifySkillName("on-call-runbook")).toBe("On Call Runbook");
  });

  it("leaves a name the user typed exactly as they wrote it", () => {
    expect(prettifySkillName("Review pull requests")).toBe("Review pull requests");
    expect(prettifySkillName("My Skill")).toBe("My Skill");
  });

  it("survives empty and malformed names", () => {
    expect(prettifySkillName("")).toBe("");
    expect(prettifySkillName("   ")).toBe("");
    expect(prettifySkillName("--a--")).toBe("A");
  });
});
