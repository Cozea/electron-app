import { Schema } from "effect";

/** Cozea DevApps launcher IPC contracts — desktop only. */

export const DevAppId = Schema.String.pipe(Schema.brand("DevAppId"));
export type DevAppId = typeof DevAppId.Type;

export const DevAppLaunchRequest = Schema.Struct({
  devAppId: DevAppId,
  projectRootPath: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
});
export type DevAppLaunchRequest = typeof DevAppLaunchRequest.Type;
