export interface ParsedSkillManifest {
  name: string;
  description: string;
  instructions: string;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function slugifySkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function parseSkillMarkdown(markdown: string, fallbackName = "skill"): ParsedSkillManifest {
  const normalized = markdown.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return {
      name: fallbackName,
      description: "",
      instructions: normalized.trim(),
    };
  }

  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?([\s\S]*)$/);
  if (!match) {
    return {
      name: fallbackName,
      description: "",
      instructions: normalized.trim(),
    };
  }

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.*)$/m);
  return {
    name: unquoteYamlScalar(nameMatch?.[1] ?? fallbackName) || fallbackName,
    description: unquoteYamlScalar(descriptionMatch?.[1] ?? ""),
    instructions: match[2].trim(),
  };
}

export function renderSkillMarkdown(input: ParsedSkillManifest): string {
  const slug = slugifySkillName(input.name) || "skill";
  return [
    "---",
    `name: ${JSON.stringify(slug)}`,
    `description: ${JSON.stringify(input.description.trim())}`,
    "---",
    "",
    input.instructions.trim(),
    "",
  ].join("\n");
}
