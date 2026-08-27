import { Schema } from "effect";

/** Cozea workspace catalog IPC contracts — desktop only. */

export const CatalogWorkspaceId = Schema.String.pipe(Schema.brand("CatalogWorkspaceId"));
export type CatalogWorkspaceId = typeof CatalogWorkspaceId.Type;

export const CatalogEntry = Schema.Struct({
  workspaceId: CatalogWorkspaceId,
  label: Schema.String,
  rootPath: Schema.String,
});
export type CatalogEntry = typeof CatalogEntry.Type;
