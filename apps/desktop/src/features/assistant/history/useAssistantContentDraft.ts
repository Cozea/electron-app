import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { PreviewAnnotationPayload } from "@cozea/contracts/t3/ipc";
import type { ComposerImageDraft } from "@/features/assistant/chat/CozeaChatSurface";
import {
  assistantDrafts,
  type AssistantContentDraft,
  type PersistedDraftImage,
} from "./assistantDraftRepository";

type DraftMetadata = Omit<
  AssistantContentDraft,
  "text" | "cursor" | "images" | "annotations" | "revision" | "updatedAt"
>;
const EMPTY_IMAGES: PersistedDraftImage[] = [];
const EMPTY_ANNOTATIONS: PreviewAnnotationPayload[] = [];
const apply = <T>(value: SetStateAction<T>, previous: T): T =>
  typeof value === "function" ? (value as (previous: T) => T)(previous) : value;

export function useAssistantContentDraft(metadata: DraftMetadata) {
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const record = assistantDrafts.store(
    (state) => state.drafts[assistantDrafts.resolveKey(metadata.key)],
  );
  const ready = assistantDrafts.store((state) => state.ready);
  const error = assistantDrafts.store((state) => state.error);
  useEffect(() => {
    void assistantDrafts.load().catch(() => {});
  }, []);

  const write = useCallback((patch: Partial<AssistantContentDraft>) => {
    const meta = metadataRef.current;
    const previous = assistantDrafts.store.getState().drafts[assistantDrafts.resolveKey(meta.key)];
    assistantDrafts.save({
      ...meta,
      ...(previous ?? { text: "", cursor: 0, images: [], annotations: [] }),
      ...patch,
      key: meta.key,
      revision:
        (previous?.revision ?? 0) +
        ("text" in patch || "images" in patch || "annotations" in patch ? 1 : 0),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  // Preferences retain their existing resolver/migration, but travel with content too.
  useEffect(() => {
    if (!ready) return;
    const previous =
      assistantDrafts.store.getState().drafts[assistantDrafts.resolveKey(metadata.key)];
    if (!previous) return;
    if (
      JSON.stringify(previous.modelSelection) !== JSON.stringify(metadata.modelSelection) ||
      previous.runtimeMode !== metadata.runtimeMode ||
      previous.interactionMode !== metadata.interactionMode
    ) {
      write({
        modelSelection: metadata.modelSelection,
        runtimeMode: metadata.runtimeMode,
        interactionMode: metadata.interactionMode,
      });
    }
  }, [
    metadata.key,
    metadata.modelSelection,
    metadata.runtimeMode,
    metadata.interactionMode,
    ready,
    write,
  ]);

  const images = record?.images ?? EMPTY_IMAGES;
  const [composerImages, setImagePreviews] = useState<ComposerImageDraft[]>([]);
  useLayoutEffect(() => {
    // URLs belong to an effect lifetime, not a render/useMemo lifetime.
    // StrictMode cleanup/replay must recreate, not reuse, revoked URLs.
    const previews = images.map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      file: new File([image.blob], image.name, { type: image.mimeType }),
      previewUrl: URL.createObjectURL(image.blob),
    }));
    setImagePreviews(previews);
    return () => {
      for (const image of previews) URL.revokeObjectURL(image.previewUrl);
    };
  }, [images]);
  const imagesRef = useRef(composerImages);
  imagesRef.current = composerImages;

  const setComposer = useCallback(
    (value: SetStateAction<string>) => {
      write({
        text: apply(
          value,
          assistantDrafts.store.getState().drafts[
            assistantDrafts.resolveKey(metadataRef.current.key)
          ]?.text ?? "",
        ),
      });
    },
    [write],
  );
  const setComposerCursor = useCallback(
    (value: SetStateAction<number>) => {
      write({
        cursor: apply(
          value,
          assistantDrafts.store.getState().drafts[
            assistantDrafts.resolveKey(metadataRef.current.key)
          ]?.cursor ?? 0,
        ),
      });
    },
    [write],
  );
  const setComposerImages = useCallback(
    (value: SetStateAction<ComposerImageDraft[]>) => {
      const next = apply(value, imagesRef.current);
      imagesRef.current = next;
      write({
        images: next.map((image) => {
          if (!image.file)
            throw new Error("This attachment has no local data. Please attach it again.");
          return {
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            blob: image.file,
          };
        }),
      });
    },
    [write],
  );
  const setComposerPreviewAnnotations = useCallback(
    (value: SetStateAction<PreviewAnnotationPayload[]>) => {
      write({
        annotations: apply(
          value,
          assistantDrafts.store.getState().drafts[
            assistantDrafts.resolveKey(metadataRef.current.key)
          ]?.annotations ?? [],
        ),
      });
    },
    [write],
  );
  return {
    composer: record?.text ?? "",
    composerCursor: record?.cursor ?? 0,
    composerImages,
    composerPreviewAnnotations: record?.annotations ?? EMPTY_ANNOTATIONS,
    setComposer,
    setComposerCursor,
    setComposerImages,
    setComposerPreviewAnnotations,
    draftReady: ready,
    draftError: error,
  };
}
