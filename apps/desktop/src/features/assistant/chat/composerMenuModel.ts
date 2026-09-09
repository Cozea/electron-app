import type { PendingUserInput } from "@/features/assistant/chat/session-logic";
import { basenameOfPath } from "@/features/assistant/vscode-icons";
import { pendingUserInputDraftFromAnswer, type PendingUserInputDraftAnswer } from "@/features/assistant/pendingUserInput";

export type ComposerPathMenuItem = {
  id: string;
  type: "path";
  path: string;
  kind: "file" | "directory";
  description: string;
};

export function includesNormalized(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

export function parentPathOf(projectPath: string): string {
  const normalizedPath = projectPath.replace(/\\/g, "/");
  const index = normalizedPath.lastIndexOf("/");
  return index > 0 ? normalizedPath.slice(0, index) : "";
}

export function buildComposerPathMenuItems(
  files: ReadonlyArray<{ path: string }>,
  query: string,
  limit = 80,
): ComposerPathMenuItem[] {
  const normalizedQuery = query.trim();
  const includeAll = normalizedQuery.length === 0 || normalizedQuery === ".";
  const byPath = new Map<string, ComposerPathMenuItem>();

  const addItem = (projectPath: string, kind: ComposerPathMenuItem["kind"]) => {
    const normalizedPath = projectPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalizedPath || byPath.has(`${kind}:${normalizedPath}`)) {
      return;
    }

    if (
      !includeAll &&
      !includesNormalized(normalizedPath, normalizedQuery) &&
      !includesNormalized(basenameOfPath(normalizedPath), normalizedQuery)
    ) {
      return;
    }

    byPath.set(`${kind}:${normalizedPath}`, {
      id: `${kind}:${normalizedPath}`,
      type: "path",
      path: normalizedPath,
      kind,
      description: parentPathOf(normalizedPath),
    });
  };

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalizedPath) continue;

    const parts = normalizedPath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      addItem(parts.slice(0, index).join("/"), "directory");
    }
    addItem(normalizedPath, "file");
  }

  return Array.from(byPath.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}

export function filterSlashItems<T extends { label: string; description: string }>(
  items: ReadonlyArray<T>,
  query: string,
): T[] {
  const normalizedQuery = query.trim().replace(/^\/+/, "").toLowerCase();
  if (!normalizedQuery) return [...items];
  return items.filter(
    (item) =>
      includesNormalized(item.label, normalizedQuery) ||
      includesNormalized(item.description, normalizedQuery),
  );
}

export function planTitleFromMarkdown(markdown: string): string | null {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const heading = lines.find((line) => line.startsWith("#"));
  if (!heading) {
    return null;
  }

  const normalized = heading.replace(/^#+\s*/, "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function toPendingUserInputDraftAnswers(
  request: PendingUserInput | null,
  drafts: Record<string, string | string[]> | undefined,
): Record<string, PendingUserInputDraftAnswer> {
  if (!request) {
    return {};
  }

  const next: Record<string, PendingUserInputDraftAnswer> = {};
  for (const question of request.questions) {
    const value = drafts?.[question.id];
    next[question.id] = pendingUserInputDraftFromAnswer(question, value);
  }
  return next;
}
