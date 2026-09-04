export interface ParsedSkillManifest {
  name: string;
  description: string;
  instructions: string;
  /** Raw `category:` frontmatter, if the author declared one. */
  category?: string;
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

/**
 * Read one top-level frontmatter key, including YAML block scalars.
 *
 * Plenty of real skills write `description: >-` followed by an indented,
 * wrapped paragraph. Matching only the rest of the key's own line captured the
 * literal ">-", which then showed up as the skill's description and left it
 * uncategorised. Only column-zero keys count, so nested keys under `metadata:`
 * cannot be mistaken for the one being read.
 */
function readFrontmatterScalar(frontmatter: string, key: string): string | null {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return null;

  const rawValue = lines[index].slice(key.length + 1).trim();
  const blockHeader = rawValue.match(/^([|>])[+-]?\d*$/);
  if (!blockHeader) return unquoteYamlScalar(rawValue);

  const body: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (!/^[ \t]/.test(line)) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  if (body.length === 0) return "";

  const indent = Math.min(
    ...body.filter((line) => line !== "").map((line) => line.length - line.trimStart().length),
  );
  const dedented = body.map((line) => (line === "" ? "" : line.slice(indent)));

  // `|` keeps the line breaks; `>` folds them into spaces, blank lines apart.
  if (blockHeader[1] === "|") return dedented.join("\n");
  return dedented
    .reduce<string[]>((paragraphs, line) => {
      if (line === "") paragraphs.push("");
      else if (paragraphs.length === 0 || paragraphs[paragraphs.length - 1] === "")
        paragraphs.push(line);
      else paragraphs[paragraphs.length - 1] += ` ${line}`;
      return paragraphs;
    }, [])
    .join("\n\n")
    .trim();
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
  const category = readFrontmatterScalar(frontmatter, "category") ?? "";
  return {
    name: readFrontmatterScalar(frontmatter, "name") || fallbackName,
    description: readFrontmatterScalar(frontmatter, "description") ?? "",
    instructions: match[2].trim(),
    ...(category ? { category } : {}),
  };
}

export function renderSkillMarkdown(input: ParsedSkillManifest): string {
  const slug = slugifySkillName(input.name) || "skill";
  const category = input.category?.trim();
  return [
    "---",
    `name: ${JSON.stringify(slug)}`,
    `description: ${JSON.stringify(input.description.trim())}`,
    ...(category ? [`category: ${JSON.stringify(category)}`] : []),
    "---",
    "",
    input.instructions.trim(),
    "",
  ].join("\n");
}
