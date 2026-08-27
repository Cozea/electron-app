import type { ContextMenuItem } from "@cozea/assistant-contracts"

function flattenContextMenuItems<T extends string>(
  items: readonly ContextMenuItem<T>[],
  prefix = "",
): ContextMenuItem<T>[] {
  return items.flatMap((item) => {
    if (item.type === "separator" || item.enabled === false) {
      return []
    }

    const label = item.label?.trim() ?? item.id
    const nextLabel = prefix ? `${prefix} > ${label}` : label

    if (item.submenu && item.submenu.length > 0) {
      return flattenContextMenuItems(item.submenu, nextLabel)
    }

    return [{ ...item, label: nextLabel }]
  })
}

export async function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  _position?: { x: number; y: number },
): Promise<T | null> {
  const actionableItems = flattenContextMenuItems(items)

  if (typeof window === "undefined" || actionableItems.length === 0) {
    return null
  }

  const options = actionableItems
    .map((item, index) => `${index + 1}. ${item.label}`)
    .join("\n")

  const response = window.prompt(`Choose an option:\n\n${options}`)
  if (!response) {
    return null
  }

  const numericChoice = Number.parseInt(response, 10)
  if (Number.isFinite(numericChoice)) {
    const selectedByIndex = actionableItems[numericChoice - 1]
    return selectedByIndex?.id ?? null
  }

  const normalizedResponse = response.trim().toLowerCase()
  const selectedByLabel = actionableItems.find(
    (item) => item.label?.trim().toLowerCase() === normalizedResponse,
  )
  if (selectedByLabel) {
    return selectedByLabel.id
  }

  const selectedById = actionableItems.find((item) => item.id.trim().toLowerCase() === normalizedResponse)
  return selectedById?.id ?? null
}
