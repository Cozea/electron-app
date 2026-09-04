import {
  createContext,
  useContext,
  type ComponentType,
  type Provider,
} from "react";

export const NATIVE_DEV_APP_DEFINITION_KIND = "cozea.native-devapp/v1" as const;

export type DevAppJsonPrimitive = string | number | boolean | null;
export type DevAppJsonValue =
  | DevAppJsonPrimitive
  | DevAppJsonValue[]
  | { [key: string]: DevAppJsonValue };

export interface DevAppDisposable {
  dispose(): void | Promise<void>;
}

export type DevAppSubscription = DevAppDisposable | (() => void | Promise<void>);

export interface NativeDevAppIdentity {
  appId: string;
  version: string;
  installationId: string;
}

export interface NativeDevAppSurfaceIdentity {
  surfaceId: string;
  instanceId: string;
  projectId: string | null;
  workspaceId: string | null;
  laneId: string | null;
}

export interface NativeDevAppCommandClient {
  execute<Result = unknown>(
    commandId: string,
    argument?: DevAppJsonValue,
  ): Promise<Result>;
}

export interface NativeDevAppSettingsClient {
  get<Value extends DevAppJsonValue = DevAppJsonValue>(
    settingId: string,
  ): Promise<Value | undefined>;
  set(settingId: string, value: DevAppJsonValue): Promise<void>;
  subscribe(
    settingId: string,
    listener: (value: DevAppJsonValue | undefined) => void,
  ): DevAppDisposable;
}

export interface NativeDevAppStorageClient {
  get<Value extends DevAppJsonValue = DevAppJsonValue>(
    key: string,
  ): Promise<Value | undefined>;
  set(key: string, value: DevAppJsonValue): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface NativeDevAppThemeClient {
  readonly colorScheme: "light" | "dark";
  subscribe(listener: (colorScheme: "light" | "dark") => void): DevAppDisposable;
}

/**
 * Capability-scoped renderer client supplied by Cozea to one surface instance.
 * It intentionally exposes no Electron object, filesystem path, or raw IPC channel.
 */
export interface NativeDevAppHostClient {
  readonly identity: NativeDevAppIdentity;
  readonly surface: NativeDevAppSurfaceIdentity;
  readonly locale: string;
  readonly commands: NativeDevAppCommandClient;
  readonly settings: NativeDevAppSettingsClient;
  readonly storage: NativeDevAppStorageClient;
  readonly theme: NativeDevAppThemeClient;
  request<Result = unknown>(method: string, params?: DevAppJsonValue): Promise<Result>;
}

export interface NativeDevAppSurfaceProps {
  readonly instanceState: DevAppJsonValue | undefined;
  setInstanceState(next: DevAppJsonValue | undefined): void;
}

export interface NativeDevAppActivationContext {
  readonly host: NativeDevAppHostClient;
  readonly subscriptions: {
    add(subscription: DevAppSubscription): void;
  };
}

export type NativeDevAppComponent = ComponentType<NativeDevAppSurfaceProps>;
export type NativeDevAppComponentMap = Record<string, NativeDevAppComponent>;

export interface NativeDevAppDefinition<
  Components extends NativeDevAppComponentMap = NativeDevAppComponentMap,
> {
  readonly kind: typeof NATIVE_DEV_APP_DEFINITION_KIND;
  readonly components: Components;
  activate?(
    context: NativeDevAppActivationContext,
  ): void | DevAppDisposable | Promise<void | DevAppDisposable>;
  deactivate?(): void | Promise<void>;
}

type NativeDevAppDefinitionInput<Components extends NativeDevAppComponentMap> = Omit<
  NativeDevAppDefinition<Components>,
  "kind"
>;

export function defineNativeDevApp<const Components extends NativeDevAppComponentMap>(
  definition: NativeDevAppDefinitionInput<Components>,
): NativeDevAppDefinition<Components> {
  return Object.freeze({
    kind: NATIVE_DEV_APP_DEFINITION_KIND,
    ...definition,
  });
}

export function isNativeDevAppDefinition(
  value: unknown,
): value is NativeDevAppDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeDevAppDefinition>;
  if (candidate.kind !== NATIVE_DEV_APP_DEFINITION_KIND) return false;
  if (!candidate.components || typeof candidate.components !== "object") return false;
  return Object.values(candidate.components).every(
    (component) => typeof component === "function" || typeof component === "object",
  );
}

export interface NativeDevAppModule {
  readonly default: NativeDevAppDefinition;
}

const NativeDevAppHostContext = createContext<NativeDevAppHostClient | null>(null);

/** Host-only provider used by Cozea around one dynamically loaded surface. */
export const NativeDevAppHostProvider: Provider<NativeDevAppHostClient | null> =
  NativeDevAppHostContext.Provider;

export function useDevAppContext(): NativeDevAppHostClient {
  const context = useContext(NativeDevAppHostContext);
  if (!context) {
    throw new Error(
      "useDevAppContext must be called inside a Cozea native DevApp surface.",
    );
  }
  return context;
}
