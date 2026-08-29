// macOS' native open panel does not consistently resolve MIME accept filters
// for files outside the app sandbox. Use extensions for the picker;
// processFile still performs the authoritative MIME and size checks.
export const PROJECT_DEVAPP_LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const PROJECT_DEVAPP_LOGO_MAX_INPUT_BYTES = 8 * 1024 * 1024;
/**
 * Every logo is re-encoded to a 256px WebP, which lands well under 40 KB of
 * base64 in practice. The ceiling is deliberately close to that reality: the
 * catalog lives in localStorage, so a generous per-logo allowance multiplied
 * by the entry cap would exceed the origin quota on its own.
 */
export const PROJECT_DEVAPP_LOGO_MAX_DATA_URL_LENGTH = 128 * 1024;
export const PROJECT_DEVAPP_LOGO_SIZE = 256;
export const PROJECT_DEVAPP_LOGO_MAX_EDGE = 4_096;
export const PROJECT_DEVAPP_LOGO_MAX_PIXELS = 16_000_000;

const SUPPORTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DATA_URL_PREFIX_PATTERN = /^data:image\/(png|jpeg|webp);base64,/;
const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ProjectDevAppLogoFileLike {
  size: number;
  type: string;
}

export function validateProjectDevAppLogoFile(file: ProjectDevAppLogoFileLike): string | null {
  if (!SUPPORTED_LOGO_TYPES.has(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "The selected image is empty.";
  }
  if (file.size > PROJECT_DEVAPP_LOGO_MAX_INPUT_BYTES) {
    return "Choose an image smaller than 8 MB.";
  }
  return null;
}

export function isProjectDevAppLogoDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length <= 0 ||
    value.length > PROJECT_DEVAPP_LOGO_MAX_DATA_URL_LENGTH
  ) {
    return false;
  }

  const match = value.match(DATA_URL_PREFIX_PATTERN);
  if (!match) return false;

  const payload = value.slice(match[0].length);
  if (payload.length < 4 || payload.length % 4 !== 0 || !BASE64_PAYLOAD_PATTERN.test(payload)) {
    return false;
  }

  let header: string;
  try {
    header = atob(payload.slice(0, Math.min(payload.length, 24)));
  } catch {
    return false;
  }

  const byte = (index: number) => header.charCodeAt(index);
  if (match[1] === "png") {
    return (
      header.length >= 8 &&
      byte(0) === 0x89 &&
      header.slice(1, 4) === "PNG" &&
      byte(4) === 0x0d &&
      byte(5) === 0x0a &&
      byte(6) === 0x1a &&
      byte(7) === 0x0a
    );
  }
  if (match[1] === "jpeg") {
    return header.length >= 3 && byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  }
  return header.length >= 12 && header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Cozea could not encode this image."));
        }
      },
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Cozea could not read this image."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Cozea could not read this image."));
      }
    };
    reader.readAsDataURL(blob);
  });
}

export async function optimizeProjectDevAppLogo(file: File): Promise<string> {
  const validationError = validateProjectDevAppLogoFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Cozea could not decode this image. Try another PNG, JPEG, or WebP file.");
  }

  try {
    const cropSize = Math.min(image.width, image.height);
    if (cropSize <= 0) {
      throw new Error("The selected image has invalid dimensions.");
    }
    if (
      image.width > PROJECT_DEVAPP_LOGO_MAX_EDGE ||
      image.height > PROJECT_DEVAPP_LOGO_MAX_EDGE ||
      image.width * image.height > PROJECT_DEVAPP_LOGO_MAX_PIXELS
    ) {
      throw new Error("Choose an image no larger than 4096 pixels per side.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = PROJECT_DEVAPP_LOGO_SIZE;
    canvas.height = PROJECT_DEVAPP_LOGO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Cozea could not prepare this image.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, PROJECT_DEVAPP_LOGO_SIZE, PROJECT_DEVAPP_LOGO_SIZE);
    context.drawImage(
      image,
      Math.floor((image.width - cropSize) / 2),
      Math.floor((image.height - cropSize) / 2),
      cropSize,
      cropSize,
      0,
      0,
      PROJECT_DEVAPP_LOGO_SIZE,
      PROJECT_DEVAPP_LOGO_SIZE,
    );

    const encoded = await canvasToBlob(canvas, "image/webp", 0.9);
    const dataUrl = await blobToDataUrl(encoded);
    if (!isProjectDevAppLogoDataUrl(dataUrl)) {
      throw new Error("The optimized logo is too large. Try a simpler image.");
    }
    return dataUrl;
  } finally {
    image.close();
  }
}
