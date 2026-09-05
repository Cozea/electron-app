import { AssistantCitation } from "@cozea/contracts/t3";
import * as Schema from "effect/Schema";
import { templateFromHastProperties } from "./chatArtifactTemplates";
import { remarkCodexDirectives } from "@cozea/client-runtime";

/** Pinned t3-citation URL shape, validated by the synchronized native contract. */
export function parseChatAssistantCitation(href: string): AssistantCitation | null {
  if (!href.startsWith("t3-citation://v1/") || href.length > 160_000) return null;
  try {
    const url = new URL(href);
    const parts = url.pathname.slice(1).split("/");
    const required = ["text", "start", "end", "prefix", "suffix"];
    const comment = url.searchParams.get("comment");
    if (
      parts.length !== 3 ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.searchParams.size !== required.length + (comment === null ? 0 : 1) ||
      required.some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return null;
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    if (!/^\d{1,16}$/.test(start) || !/^\d{1,16}$/.test(end)) return null;
    return Schema.decodeUnknownSync(AssistantCitation)({
      version: 1,
      environmentId: decodeURIComponent(parts[0]!),
      threadId: decodeURIComponent(parts[1]!),
      messageId: decodeURIComponent(parts[2]!),
      text: url.searchParams.get("text"),
      start: Number(start),
      end: Number(end),
      prefix: url.searchParams.get("prefix"),
      suffix: url.searchParams.get("suffix"),
      ...(comment === null ? {} : { comment }),
    });
  } catch {
    return null;
  }
}

interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/** Native grammar, with Cozea's stricter composer-action identifier validation. */
export function remarkChatRichOutput(this: ThisParameterType<typeof remarkCodexDirectives>) {
  const transform = remarkCodexDirectives.call(this);
  return (tree: unknown, file: { value: unknown }) => {
    transform(tree, file);
    const visit = (node: MarkdownNode) => {
      const properties = node.data?.hProperties;
      if (
        properties?.dataCodexArtifactTemplate === "true" &&
        !templateFromHastProperties(properties)
      ) {
        // A future/invalid template must remain readable, not become an empty
        // card or insert arbitrary text into the ordinary composer draft.
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const source =
          typeof file.value === "string" && start !== undefined && end !== undefined
            ? file.value.slice(start, end)
            : String(properties.dataDisplayName ?? "Unsupported template");
        node.type = "paragraph";
        node.children = [{ type: "text", value: source }];
        delete node.data;
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree as MarkdownNode);
  };
}
