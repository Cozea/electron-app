import type { DevAppCapability } from "./shared/devAppCapabilities";
import type {
  DevAppDisposable,
  DevAppJsonValue,
  DevAppSubscription,
} from "./native";

export const DEV_APP_EXTENSION_DEFINITION_KIND = "cozea.devapp-extension/v1" as const;

export interface DevAppExtensionCommandContext {
  readonly projectId: string | null;
  readonly workspaceId: string | null;
  readonly laneId: string | null;
  readonly instanceId: string | null;
  readonly signal: AbortSignal;
}

export type DevAppExtensionCommandHandler = (
  argument: DevAppJsonValue | undefined,
  context: DevAppExtensionCommandContext,
) => DevAppJsonValue | void | Promise<DevAppJsonValue | void>;

export interface DevAppExtensionContext {
  readonly appId: string;
  readonly version: string;
  readonly installationId: string;
  readonly dataScope: "none" | "instance" | "device" | "project" | "organization";
  readonly grantedCapabilities: ReadonlySet<DevAppCapability>;
  readonly commands: {
    register(
      commandId: string,
      handler: DevAppExtensionCommandHandler,
    ): DevAppDisposable;
  };
  readonly host: {
    request<Result = unknown>(method: string, params?: DevAppJsonValue): Promise<Result>;
  };
  readonly subscriptions: {
    add(subscription: DevAppSubscription): void;
  };
}

export interface DevAppExtensionDefinition {
  readonly kind: typeof DEV_APP_EXTENSION_DEFINITION_KIND;
  activate(
    context: DevAppExtensionContext,
  ): void | DevAppDisposable | Promise<void | DevAppDisposable>;
  deactivate?(): void | Promise<void>;
}

type DevAppExtensionDefinitionInput = Omit<DevAppExtensionDefinition, "kind">;

export function defineDevAppExtension(
  definition: DevAppExtensionDefinitionInput,
): DevAppExtensionDefinition {
  return Object.freeze({
    ...definition,
    kind: DEV_APP_EXTENSION_DEFINITION_KIND,
  });
}

export function isDevAppExtensionDefinition(
  value: unknown,
): value is DevAppExtensionDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DevAppExtensionDefinition>;
  return (
    candidate.kind === DEV_APP_EXTENSION_DEFINITION_KIND &&
    typeof candidate.activate === "function"
  );
}
