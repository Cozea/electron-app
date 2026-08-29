import { type TurnDiffFileChange } from "@/stores/types";
import { summarizeTurnDiffStats } from "./turnDiffTree";

/**
 * Presentation rules for changed-file lists, ported from the upstream t3code
 * timeline. Kept as pure functions so the heuristics stay testable without
 * mounting the timeline.
 */

export const CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT = 5;
export const CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT = 200;
export const CHANGED_FILES_PREVIEW_FILE_LIMIT = 3;
export const CHANGED_FILES_PREVIEW_SCOPE_LIMIT = 4;

export interface ChangedFilesScopeSummary {
  readonly label: string;
  readonly fileCount: number;
}

function pathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** Basename for display; the full path belongs in a tooltip, not the chip. */
export function changedFileName(pathValue: string): string {
  return pathSegments(pathValue).at(-1) ?? pathValue;
}

function changedFileScope(pathValue: string): string {
  const segments = pathSegments(pathValue);
  return segments.length > 1 ? (segments[0] ?? "root") : "root";
}

/** Small, recent turns open themselves; large ones stay collapsed. */
export function shouldAutoExpandChangedFiles(
  files: ReadonlyArray<TurnDiffFileChange>,
  isLatestTurn: boolean,
): boolean {
  if (!isLatestTurn || files.length > CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT) {
    return false;
  }
  const stat = summarizeTurnDiffStats(files);
  return stat.additions + stat.deletions <= CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT;
}

/** Top-level directory tallies, busiest first, for the collapsed summary line. */
export function summarizeChangedFileScopes(
  files: ReadonlyArray<TurnDiffFileChange>,
  limit = CHANGED_FILES_PREVIEW_SCOPE_LIMIT,
): ChangedFilesScopeSummary[] {
  const scopes = new Map<string, { fileCount: number; firstIndex: number }>();
  files.forEach((file, index) => {
    const label = changedFileScope(file.path);
    const current = scopes.get(label);
    scopes.set(label, {
      fileCount: (current?.fileCount ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index,
    });
  });

  return Array.from(scopes, ([label, scope]) => ({
    label,
    fileCount: scope.fileCount,
    firstIndex: scope.firstIndex,
  }))
    .toSorted(
      (left, right) =>
        right.fileCount - left.fileCount ||
        left.firstIndex - right.firstIndex ||
        left.label.localeCompare(right.label),
    )
    .slice(0, limit)
    .map(({ label, fileCount }) => ({ label, fileCount }));
}

/**
 * Spread the preview across distinct top-level directories before falling back
 * to document order, so a turn touching several areas does not preview three
 * files from the same folder.
 */
export function selectChangedFilePreview(
  files: ReadonlyArray<TurnDiffFileChange>,
  limit = CHANGED_FILES_PREVIEW_FILE_LIMIT,
): TurnDiffFileChange[] {
  const selected: TurnDiffFileChange[] = [];
  const selectedPaths = new Set<string>();
  const selectedScopes = new Set<string>();

  for (const file of files) {
    const scope = changedFileScope(file.path);
    if (selectedScopes.has(scope)) {
      continue;
    }
    selected.push(file);
    selectedPaths.add(file.path);
    selectedScopes.add(scope);
    if (selected.length === limit) {
      return selected;
    }
  }

  for (const file of files) {
    if (selectedPaths.has(file.path)) {
      continue;
    }
    selected.push(file);
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}
