import { EDITORS, EditorId } from "@cozea/assistant-contracts";
import type { NativeApi } from "@cozea/assistant-contracts";
import { readStoredExternalEditorPreference } from "@/features/projects/lib/externalEditorPreference";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "@/hooks/useLocalStorage";
import { useMemo } from "react";

const LAST_EDITOR_KEY = "cozea:last-editor";

function resolvePersistedEditorId(): EditorId | null {
  return getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(
    LAST_EDITOR_KEY,
    resolvePersistedEditorId(),
    EditorId,
  );

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const workbench = readStoredExternalEditorPreference();
  if (workbench && availableEditorIds.has(workbench as EditorId)) {
    return workbench as EditorId;
  }
  const stored = resolvePersistedEditorId();
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export async function openInPreferredEditor(api: NativeApi, targetPath: string): Promise<EditorId> {
  const config = await api.server.getConfig();
  const availableEditors = (config as any).availableEditors as readonly EditorId[];
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}
