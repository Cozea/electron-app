/** @generated from vendor/t3code/packages/contracts @ 59e1f1749a90912a5d68eedf026c4ba7fdcfb204; run scripts/vendor/sync-t3-contracts.mjs */
import * as Schema from "effect/Schema";

/**
 * Key of one `settings.usageLimitSources` entry. Lives in its own module so
 * both the settings and the usage-limit contracts can import it without
 * importing each other.
 */
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;
