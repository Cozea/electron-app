import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComposerSourceMenu,
  type ComposerSourceSection,
} from "@/features/assistant/chat/ComposerSourceMenu";

const sections: ComposerSourceSection[] = [
  {
    key: "sources",
    rows: [
      {
        key: "attach",
        name: "Add photos & files",
        description: "Upload from your computer",
        onSelect: () => {},
      },
      {
        key: "slack",
        name: "Slack",
        description: "Read and manage Slack",
        disabled: true,
        status: "Soon",
        onSelect: () => {},
      },
    ],
  },
  {
    key: "modes",
    rows: [
      {
        key: "ask",
        name: "Ask Mode",
        status: "On",
        statusTone: "positive",
        onSelect: () => {},
      },
    ],
  },
];

function markup() {
  return renderToStaticMarkup(<ComposerSourceMenu sections={sections} onClose={() => {}} />);
}

describe("composer source menu", () => {
  it("renders each row as a name with its description", () => {
    const html = markup();
    expect(html).toContain("Add photos &amp; files");
    expect(html).toContain("Upload from your computer");
    expect(html).toContain("Ask Mode");
  });

  it("marks rows we cannot act on as disabled", () => {
    const html = markup();
    // Slack is a placeholder: shown, labelled "Soon", and not clickable.
    expect(html).toContain("Soon");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Slack/);
  });

  it("offers the search field the reference menu has", () => {
    expect(markup()).toContain('placeholder="Type to search sources &amp; files"');
  });

  it("does not claim a connection for an integration we have not built", () => {
    expect(markup()).not.toContain("Connected");
  });
});
