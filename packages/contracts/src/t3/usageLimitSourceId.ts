/** @generated from vendor/t3code/packages/contracts @ f2df43a98bc42936dd2a031d832c8c4dae53398a; run scripts/vendor/sync-t3-contracts.mjs */
import * as Schema from "effect/Schema";

/**
 * Key of one `settings.usageLimitSources` entry. Lives in its own module so
 * both the settings and the usage-limit contracts can import it without
 * importing each other.
 */
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;
