import type { ComposerImageDraft } from "@/features/assistant/model/assistantComposerTypes";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export async function prepareComposerImageUploads(images: readonly ComposerImageDraft[]) {
  return Promise.all(
    images.map(async (image) => {
      if (!image.file) {
        throw new Error(`Attachment '${image.name}' is no longer available.`);
      }
      return {
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      };
    }),
  );
}
