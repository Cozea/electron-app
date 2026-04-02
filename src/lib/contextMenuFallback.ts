import type { ContextMenuItem } from "@cozea/assistant-contracts"

export async function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  _position?: { x: number; y: number },
): Promise<T | null> {
  if (typeof window === "undefined" || items.length === 0) {
    return null
  }

  const options = items
    .map((item, index) => `${index + 1}. ${item.label}`)
    .join("\n")

  const response = window.prompt(`Choose an option:\n\n${options}`)
  if (!response) {
    return null
  }

  const numericChoice = Number.parseInt(response, 10)
  if (Number.isFinite(numericChoice)) {
    const selectedByIndex = items[numericChoice - 1]
    return selectedByIndex?.id ?? null
  }

  const normalizedResponse = response.trim().toLowerCase()
  const selectedByLabel = items.find((item) => item.label.trim().toLowerCase() === normalizedResponse)
  if (selectedByLabel) {
    return selectedByLabel.id
  }

  const selectedById = items.find((item) => item.id.trim().toLowerCase() === normalizedResponse)
  return selectedById?.id ?? null
}
