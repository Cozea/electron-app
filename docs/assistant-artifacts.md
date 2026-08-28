# Assistant artifacts

Assistant tiles expose generated images as thread-scoped artifacts. The tile header switches between `Chat` and `Artifacts`; both views belong to the same bound thread. Switching views only hides the chat surface. It does not unmount the controller, interrupt an active turn, or unsubscribe from the T3 thread stream.

## Image lifecycle

Provider adapters normalize image creation as `image_generation`. Viewing an existing image remains `image_view`. Each generated image keeps the provider tool-call id as its stable artifact id, so started, updated, completed, failed, and cancelled events fold into one row and one gallery item.

The live row is intentionally indeterminate. Providers do not consistently emit progress percentages. When a provider supplies a prompt or revised prompt, the completed item adopts a bounded descriptive title; otherwise it keeps a generic generated-image label.

The transcript renders a compact completed-image thumbnail. Selecting it switches the same tile to the artifact detail view. The gallery supports viewing, copying, and saving an image. Artifact state is derived from the existing thread activity stream, so reconnecting does not duplicate items and historical Codex image generations require no migration.

## Media boundary

Thread snapshots contain bounded artifact metadata only: id, kind, lifecycle status, optional title/prompt/MIME type, and availability. They never expose generated-image bytes or absolute filesystem paths.

The renderer requests media on demand through T3's `assets.createUrl` RPC with a `thread-artifact` resource. The server resolves the artifact id against the authoritative persisted thread activity, canonicalizes the generated file, and returns a short-lived signed URL bound to that exact file. A token cannot traverse directories or resolve a sibling asset.

Images are the first artifact kind. Keep the client model discriminated by `kind` when adding later artifact types, and preserve the same thread scope, stable lifecycle identity, bounded snapshot projection, and on-demand media boundary.
