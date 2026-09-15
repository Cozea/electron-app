import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DRAFT_STARTER_PROMPTS,
  DraftHeroHeadline,
  type DraftStarterPrompt,
} from "@/features/assistant/chat/DraftHeroHeadline";
import { MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME } from "@/features/assistant/chat/draftHeroTransition";

describe("DraftHeroHeadline", () => {
  it("exports 4 comprehensive starter prompts by default", () => {
    expect(DEFAULT_DRAFT_STARTER_PROMPTS).toHaveLength(4);
    const ids = DEFAULT_DRAFT_STARTER_PROMPTS.map((p) => p.id);
    expect(ids).toEqual([
      "review-staged",
      "explain-architecture",
      "scan-bugs",
      "run-tests",
    ]);

    expect(DEFAULT_DRAFT_STARTER_PROMPTS[0].prompt).toBe(
      "Review staged git changes and suggest refinements",
    );
    expect(DEFAULT_DRAFT_STARTER_PROMPTS[1].prompt).toBe(
      "Explain the high-level architecture and key components of this project",
    );
    expect(DEFAULT_DRAFT_STARTER_PROMPTS[2].prompt).toBe(
      "Scan the current workspace for potential bugs, dead code, and security risks",
    );
    expect(DEFAULT_DRAFT_STARTER_PROMPTS[3].prompt).toBe(
      "Run the test suite and report any failures or regressions",
    );
  });

  it("renders with project name in headline", () => {
    const html = renderToStaticMarkup(
      createElement(DraftHeroHeadline, {
        projectName: "electron-app",
      }),
    );

    expect(html).toContain("What should we build in electron-app?");
    expect(html).toContain('role="region"');
    expect(html).toContain('data-testid="draft-hero-title"');
    expect(html).toContain(
      `view-transition-name:${MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME}`,
    );
  });

  it("renders default headline when project name is null or undefined", () => {
    const html = renderToStaticMarkup(
      createElement(DraftHeroHeadline, {
        projectName: null,
      }),
    );

    expect(html).toContain("What would you like to build today?");
    expect(html).not.toContain("What should we build in");
  });

  it("renders all 4 starter prompt cards with icons and descriptions", () => {
    const html = renderToStaticMarkup(
      createElement(DraftHeroHeadline, {
        projectName: "acme-corp",
      }),
    );

    expect(html).toContain("Review Staged Changes");
    expect(html).toContain(
      "Inspect git status and diffs for clean commit readiness",
    );
    expect(html).toContain("Explain Architecture");
    expect(html).toContain(
      "Map key modules, entrypoints, and data flows",
    );
    expect(html).toContain("Scan for Bugs");
    expect(html).toContain(
      "Find potential edge-case flaws and security issues",
    );
    expect(html).toContain("Run Test Suites");
    expect(html).toContain(
      "Execute automated tests and diagnose failures",
    );

    expect(html).toContain('data-testid="draft-starter-prompt-review-staged"');
    expect(html).toContain(
      'data-testid="draft-starter-prompt-explain-architecture"',
    );
    expect(html).toContain('data-testid="draft-starter-prompt-scan-bugs"');
    expect(html).toContain('data-testid="draft-starter-prompt-run-tests"');
  });

  it("supports custom starter prompts", () => {
    const customPrompts: readonly DraftStarterPrompt[] = [
      {
        id: "custom-deploy",
        title: "Deploy to Staging",
        description: "Trigger a staging release pipeline",
        prompt: "Deploy latest build to staging environment",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(DraftHeroHeadline, {
        projectName: "my-app",
        starterPrompts: customPrompts,
      }),
    );

    expect(html).toContain("Deploy to Staging");
    expect(html).toContain("Trigger a staging release pipeline");
    expect(html).toContain('data-testid="draft-starter-prompt-custom-deploy"');
    expect(html).not.toContain("Review Staged Changes");
  });

  it("renders accessible region and interactive buttons", () => {
    const html = renderToStaticMarkup(
      createElement(DraftHeroHeadline, {
        projectName: "frontend",
      }),
    );

    expect(html).toContain('aria-label="Conversation starter"');
    expect(html).toContain('aria-label="Starter prompt: Review Staged Changes"');
    expect(html).toContain('type="button"');
  });
});
