/** @generated from vendor/t3code/packages/contracts @ 53fc2f7efd2df38f0388d7fa94ec3456d6f2a33c; run scripts/vendor/sync-t3-contracts.mjs */
import * as Schema from "effect/Schema";

/**
 * Key of one `settings.usageLimitSources` entry. Lives in its own module so
 * both the settings and the usage-limit contracts can import it without
 * importing each other.
 */
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;
