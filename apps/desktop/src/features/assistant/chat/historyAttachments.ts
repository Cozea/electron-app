/** New attachment kinds remain readable without pretending they are images. */
export function nonImageAttachmentLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || entry.type === "image") return [];
    return [typeof entry.name === "string" && entry.name.trim() ? entry.name : "Attachment"];
  });
}
