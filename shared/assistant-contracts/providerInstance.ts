import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

const PROVIDER_SLUG_MAX_CHARS = 64;
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ENVIRONMENT_VARIABLE_NAME_MAX_CHARS = 128;
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ProviderSlug = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

const makeProviderSlugId = <Brand extends string>(brand: Brand) => {
  const schema = ProviderSlug.pipe(Schema.brand(brand));
  return Object.assign(schema, {
    make: Schema.decodeUnknownSync(schema),
    makeUnsafe: Schema.decodeUnknownSync(schema),
  });
};

export const ProviderDriverKind = makeProviderSlugId("ProviderDriverKind");
export type ProviderDriverKind = typeof ProviderDriverKind.Type;

const isProviderDriverKindValue = Schema.is(ProviderDriverKind);
export const isProviderDriverKind = (value: unknown): value is ProviderDriverKind =>
  isProviderDriverKindValue(value);

export const ProviderInstanceId = makeProviderSlugId("ProviderInstanceId");
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

export const ProviderInstanceRef = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
});
export type ProviderInstanceRef = typeof ProviderInstanceRef.Type;

export const ProviderInstanceEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ENVIRONMENT_VARIABLE_NAME_MAX_CHARS),
  Schema.isPattern(ENVIRONMENT_VARIABLE_NAME_PATTERN),
);
export type ProviderInstanceEnvironmentVariableName =
  typeof ProviderInstanceEnvironmentVariableName.Type;

export const ProviderInstanceEnvironmentVariable = Schema.Struct({
  name: ProviderInstanceEnvironmentVariableName,
  value: Schema.String.pipe(Schema.withDecodingDefault(() => "")),
  sensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});
export type ProviderInstanceEnvironmentVariable =
  typeof ProviderInstanceEnvironmentVariable.Type;

export const ProviderInstanceEnvironment = Schema.Array(ProviderInstanceEnvironmentVariable);
export type ProviderInstanceEnvironment = typeof ProviderInstanceEnvironment.Type;

export const ProviderInstanceConfig = Schema.Struct({
  driver: ProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
  enabled: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Unknown),
});
export type ProviderInstanceConfig = typeof ProviderInstanceConfig.Type;

export const ProviderInstanceConfigMap = Schema.Record(
  ProviderInstanceId,
  ProviderInstanceConfig,
);
export type ProviderInstanceConfigMap = typeof ProviderInstanceConfigMap.Type;

export const defaultInstanceIdForDriver = (
  driver: ProviderDriverKind,
): ProviderInstanceId => ProviderInstanceId.make(driver);
