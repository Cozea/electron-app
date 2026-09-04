import * as Schema from "effect/Schema";
import { WS_METHODS } from "@cozea/contracts/t3/rpc";
import { ProviderAuthState, ProviderInstallState } from "@cozea/contracts/t3/providerSetup";
import type { T3EffectRpcClient } from "@cozea/client-runtime";
import type { ProviderSetupApi } from "@shared/assistant-contracts/providerSetup";

/** Decode setup results explicitly; do not cast a new server protocol to a legacy shape. */
export function createT3ProviderSetupApi(
  client: Pick<T3EffectRpcClient, "callUnary" | "openStream">,
): ProviderSetupApi {
  const decodeAuth = (instanceId: string, value: unknown) => {
    const state = Schema.decodeUnknownSync(ProviderAuthState)(value);
    if (state.instanceId !== instanceId)
      throw new Error("The provider returned sign-in state for a different account.");
    return state;
  };
  const auth = async (method: string, input: { instanceId: string; flowId?: string }) =>
    decodeAuth(input.instanceId, await client.callUnary(method, input));
  const install = async (method: string, input: object) =>
    Schema.decodeUnknownSync(ProviderInstallState)(await client.callUnary(method, input));
  return {
    startAuth: (instanceId) => auth(WS_METHODS.providerAuthStart, { instanceId }),
    cancelAuth: (instanceId, flowId) => auth(WS_METHODS.providerAuthCancel, { instanceId, flowId }),
    logout: (instanceId) => auth(WS_METHODS.providerAuthLogout, { instanceId }),
    startInstall: (instanceId) => install(WS_METHODS.providerInstallStart, { instanceId }),
    cancelInstall: (instanceId, operationId) =>
      install(WS_METHODS.providerInstallCancel, { instanceId, operationId }),
    removeInstall: (instanceId) => install(WS_METHODS.providerInstallRemove, { instanceId }),
    subscribeAuth: (instanceId, onState) =>
      client.openStream(WS_METHODS.providerAuthSubscribe, { instanceId }, (value) =>
        onState(decodeAuth(instanceId, value)),
      ),
    subscribeInstall: (instanceId, onState) =>
      client.openStream(WS_METHODS.providerInstallSubscribe, { instanceId }, (value) =>
        onState(Schema.decodeUnknownSync(ProviderInstallState)(value)),
      ),
  };
}
