import type { ProviderKind } from "@cozea/assistant-contracts";

export function providerImageRejection(
  provider: ProviderKind,
  images: ReadonlyArray<{ mimeType: string; sizeBytes: number }>,
): string | null {
  if (provider !== "antigravity") return null;
  const allowed = new Set(["image/bmp", "image/jpeg", "image/png", "image/webp"]);
  if (images.some((image) => !allowed.has(image.mimeType.toLowerCase().split(";", 1)[0] ?? "")))
    return "Antigravity accepts BMP, JPEG, PNG, and WebP images.";
  if (images.some((image) => image.sizeBytes > 10 * 1024 * 1024))
    return "Antigravity accepts images up to 10 MiB each.";
  if (images.reduce((total, image) => total + image.sizeBytes, 0) > 50 * 1024 * 1024)
    return "Antigravity accepts up to 50 MiB of attachments per message.";
  return null;
}
