import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "./base";

export const HealthInput = Schema.Struct({});
export type HealthInput = typeof HealthInput.Type;

export const BridgeStatus = Schema.Literals([
  "unknown",
  "reachable",
  "unreachable",
  "skipped",
]);
export type BridgeStatus = typeof BridgeStatus.Type;

export const HealthResult = Schema.Struct({
  ok: Schema.Literal(true),
  role: Schema.Literal("shadow"),
  phase: Schema.Literals([1, 2]),
  pin: TrimmedNonEmptyString,
  rpcChat: Schema.Boolean,
  bridge: Schema.Struct({
    status: BridgeStatus,
    assistantHttpUrl: TrimmedString,
    detail: Schema.optionalKey(TrimmedString),
  }),
  checkedAt: IsoDateTime,
});
export type HealthResult = typeof HealthResult.Type;
