export interface SelectableTaskContext {
  kind: "page" | "file"
  value: string
  label: string
  title: string
}

export function selectDefaultTaskContext<
  PageContext extends SelectableTaskContext,
  FileContext extends SelectableTaskContext,
>(
  pageOptions: readonly PageContext[],
  fileOptions: readonly FileContext[],
): PageContext | FileContext | null {
  return pageOptions[0] ?? fileOptions[0] ?? null
}

export function resolveAvailableTaskContextKind(
  requestedKind: "page" | "file",
  pageCount: number,
  fileCount: number,
): "page" | "file" {
  if (requestedKind === "page" && pageCount === 0 && fileCount > 0) return "file"
  if (requestedKind === "file" && fileCount === 0 && pageCount > 0) return "page"
  return requestedKind
}
