import { ALL_DEV_APP_CAPABILITIES } from "./devAppCapabilities"
import { DEV_APP_MANIFEST_V3 } from "./devAppManifestV3"

const APP_ID_PATTERN = "^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$"
const SEMVER_PATTERN = "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$"

/** Minimal schema exposed to editors and agent tooling; runtime parsing remains authoritative. */
export const DEV_APP_MANIFEST_V3_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://docs.cozea.dev/schemas/cozea-devapp-v3.schema.json",
  title: "Cozea DevApp manifest v3",
  description:
    "A Cozea DevApp with native React surfaces, optional web applications, services, and extension-host contributions.",
  type: "object",
  additionalProperties: false,
  required: ["manifestVersion", "id", "name", "version", "engines", "contributes"],
  properties: {
    manifestVersion: { const: DEV_APP_MANIFEST_V3 },
    id: { type: "string", pattern: APP_ID_PATTERN, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    version: { type: "string", pattern: SEMVER_PATTERN },
    description: { type: "string", maxLength: 500 },
    engines: {
      type: "object",
      additionalProperties: false,
      required: ["cozea", "nativeApi"],
      properties: {
        cozea: { type: "string", minLength: 1, maxLength: 120 },
        nativeApi: { type: "integer", minimum: 1 },
      },
    },
    rendererModules: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["entry"],
        properties: {
          entry: { $ref: "#/$defs/packagePath" },
          styles: { $ref: "#/$defs/packagePath" },
        },
      },
    },
    webApplications: { type: "object" },
    extension: {
      type: "object",
      additionalProperties: false,
      required: ["entry"],
      properties: { entry: { $ref: "#/$defs/packagePath" } },
    },
    services: { type: "object" },
    permissions: {
      type: "object",
      additionalProperties: false,
      properties: {
        required: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", enum: [...ALL_DEV_APP_CAPABILITIES] },
        },
        optional: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", enum: [...ALL_DEV_APP_CAPABILITIES] },
        },
      },
    },
    build: { type: "object" },
    contributes: {
      type: "object",
      additionalProperties: false,
      required: ["surfaces"],
      properties: {
        surfaces: {
          type: "array",
          minItems: 1,
          items: { type: "object" },
        },
        commands: { type: "array" },
        skills: { type: "array" },
        settings: { type: "array" },
      },
    },
  },
  $defs: {
    packagePath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      pattern: "^(?![\\\\/])(?![A-Za-z]:)(?!.*(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)).+$",
    },
  },
} as const
