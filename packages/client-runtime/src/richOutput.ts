/**
 * Pure Markdown grammar from the recorded T3 pin. Uses the vendor's existing
 * locked dependencies, prepared by `bun run bootstrap`; Vite bundles this code
 * into the renderer, so installed apps do not load source from the checkout.
 * Keep Effect/runtime adapters outside this bridge.
 */
export { remarkCodexDirectives } from "../../../vendor/t3code/packages/client-runtime/src/codexMarkdownDirectives";
