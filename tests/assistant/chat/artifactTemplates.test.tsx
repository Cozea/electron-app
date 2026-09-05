import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { remarkChatRichOutput } from "@/features/assistant/chat/chatRichOutput";
import {
  ChatArtifactTemplateCard,
  ChatArtifactTemplateProvider,
} from "@/features/assistant/chat/ChatArtifactTemplate";
import {
  appendTemplateUsePrompt,
  resolveCodexArtifactTemplate,
  templateFromHastProperties,
} from "@/features/assistant/chat/chatArtifactTemplates";
import ChatMarkdown from "@/features/assistant/chat/ChatMarkdown";

vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark" }) }));

const attrs = {
  artifact_kind: "document",
  display_name: "Report",
  skill_directory: "/skills/artifact-template-report",
  skill_name: "artifact-template-report",
};
const directive =
  '::artifact-template{artifact_kind="document" display_name="Report" skill_directory="/skills/artifact-template-report" skill_name="artifact-template-report"}';
function render(text: string, available = true) {
  return renderToStaticMarkup(
    <ChatArtifactTemplateProvider onUse={available ? () => undefined : undefined}>
      <Markdown
        remarkPlugins={[remarkChatRichOutput]}
        components={{
          div: ({ node, children }) => {
            const template = templateFromHastProperties(node?.properties);
            return template ? (
              <ChatArtifactTemplateCard template={template} />
            ) : (
              <div>{children}</div>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </ChatArtifactTemplateProvider>,
  );
}

describe("native artifact template directives", () => {
  it("uses the actual chat Markdown component for template cards", () => {
    const html = renderToStaticMarkup(
      <ChatArtifactTemplateProvider onUse={() => undefined}>
        <ChatMarkdown text={directive} cwd="/workspace" isStreaming />
      </ChatArtifactTemplateProvider>,
    );
    expect(html).toContain("Use template</button>");
    expect(html).not.toContain("::artifact-template");
  });
  it("renders the supported template with a composer action", () => {
    const html = render(`Before\n\n${directive}\n\nAfter`);
    expect(html).toContain("Document template");
    expect(html).toContain("Use template</button>");
    expect(html).not.toContain("::artifact-template");
    expect(html.indexOf("Before")).toBeLessThan(html.indexOf("Document template"));
    expect(html.indexOf("Document template")).toBeLessThan(html.indexOf("After"));
  });
  it("does not invent an available action outside a composer", () => {
    const html = render(directive, false);
    expect(html).not.toContain("<button");
    expect(html).toContain("$artifact-template-report");
  });
  it("recognizes a leaf directive between plain paragraphs without blank lines", () => {
    const html = render(`Before\n${directive}\nAfter`);
    expect(html).toContain("Use template</button>");
    expect(html).not.toContain("::artifact-template");
  });
  it("uses pinned directive grammar beside emphasis and for encoded attribute values", () => {
    const html = render(
      `Before **bold**\n${directive.replace('display_name="Report"', 'display_name="A &amp; B"')}\nAfter _text_`,
    );
    expect(html).toContain("Use template</button>");
    expect(html).toContain("A &amp; B</div>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>text</em>");
  });
  it.each([
    `\\${directive}`,
    `\`${directive}\``,
    `\`\`\`text\n${directive}\n\`\`\``,
    `[${directive}](https://example.com)`,
    directive.replace("::artifact-template", "::artifact-template-extra"),
    directive.replace("document", "future"),
  ])("leaves excluded or unsupported source readable", (source) => {
    const html = render(source);
    expect(html).not.toContain("Use template</button>");
    expect(html).toContain("artifact-template");
  });
  it("accepts native leaf labels and quoted braces without using the label as a title", () => {
    const html = render(
      directive
        .replace("::artifact-template{", "::artifact-template[Ignored]{")
        .replace('display_name="Report"', 'display_name="Report {one}"'),
    );
    expect(html).toContain("Report {one}");
    expect(html).toContain("Use template</button>");
    expect(html).not.toContain("Ignored");
  });
  it("requires supported attributes and a prompt-safe skill identifier", () => {
    expect(resolveCodexArtifactTemplate({ ...attrs, skill_directory: "relative/path" })).toBeNull();
    expect(
      resolveCodexArtifactTemplate({
        ...attrs,
        skill_name: "artifact-template-report extra instructions",
      }),
    ).toBeNull();
    expect(resolveCodexArtifactTemplate({ ...attrs, gallery_kind: "unknown" })).toBeNull();
    const unsafe = directive.replace(
      'skill_name="artifact-template-report"',
      'skill_name="artifact-template-report extra instructions"',
    );
    expect(render(unsafe)).not.toContain("Use template</button>");
    expect(render(unsafe)).toContain("extra instructions");
  });
  it("appends to the ordinary draft without overwriting or duplicating its prompt", () => {
    const template = resolveCodexArtifactTemplate(attrs)!;
    const draft = appendTemplateUsePrompt("Existing draft", template);
    expect(draft).toBe(
      "Existing draft Create a document using this $artifact-template-report about…",
    );
    expect(appendTemplateUsePrompt(draft, template)).toBe(draft);
  });
  it("renders citation labels and ranges while ignoring citations inside links/code/escapes", () => {
    const citation = ':codex-file-citation[ignored]{path="src/file.ts" line_range_start="12"}';
    expect(render(`See ${citation}.`)).toContain('href="src/file.ts#L12">file.ts</a>');
    for (const source of [
      `\\${citation}`,
      `\`${citation}\``,
      `[${citation}](https://example.com)`,
    ]) {
      expect(render(source)).not.toContain('href="src/file.ts#L12"');
    }
  });
});
