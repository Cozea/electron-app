import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationStatusLine } from "@/features/assistant/chat/GenerationStatusLine";

describe("GenerationStatusLine", () => {
  it("immediately reserves a fixed h-7 min-h-7 row so layout never shifts", () => {
    const html = renderToStaticMarkup(
      <GenerationStatusLine textKey="thinking">
        <span>Thinking</span>
      </GenerationStatusLine>,
    );

    expect(html).toContain("h-7");
    expect(html).toContain("min-h-7");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("Thinking");
  });

  it("renders working text with timer inside the rolling slot", () => {
    const html = renderToStaticMarkup(
      <GenerationStatusLine textKey="working">
        <span>Working</span>
        <span>for</span>
        <span>5s</span>
      </GenerationStatusLine>,
    );

    expect(html).toContain("Working");
    expect(html).toContain("5s");
    expect(html).toContain("tabular-nums");
  });

  it("renders tool summary inside the rolling slot", () => {
    const html = renderToStaticMarkup(
      <GenerationStatusLine textKey="Running bun test">
        <span>Running bun test</span>
      </GenerationStatusLine>,
    );

    expect(html).toContain("Running bun test");
    expect(html).toContain("overflow-hidden");
  });
});
