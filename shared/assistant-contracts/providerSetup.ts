import type {
  ProviderAuthState,
  ProviderInstallState,
} from "../../packages/contracts/src/t3/providerSetup";
export type { ProviderAuthState, ProviderInstallState };
export interface ProviderSetupApi {
  startAuth(instanceId: string): Promise<ProviderAuthState>;
  cancelAuth(instanceId: string, flowId: string): Promise<ProviderAuthState>;
  logout(instanceId: string): Promise<ProviderAuthState>;
  startInstall(instanceId: string): Promise<ProviderInstallState>;
  cancelInstall(instanceId: string, operationId: string): Promise<ProviderInstallState>;
  removeInstall(instanceId: string): Promise<ProviderInstallState>;
  subscribeAuth(
    instanceId: string,
    onState: (state: ProviderAuthState) => void,
  ): Promise<() => Promise<void>>;
  subscribeInstall(
    instanceId: string,
    onState: (state: ProviderInstallState) => void,
  ): Promise<() => Promise<void>>;
}
