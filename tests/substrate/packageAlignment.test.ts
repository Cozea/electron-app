import { describe, expect, it } from "vitest";

import {
  SUBSTRATE_RPC_METHODS as ContractMethods,
  SUBSTRATE_RPC_WS_PATH as ContractWsPath,
} from "@cozea/contracts";
import {
  SubstrateChatClient as ClientRuntimeChatClient,
  readSubstrateRpcChatFlags as clientRuntimeFlags,
} from "@cozea/client-runtime";
import {
  SUBSTRATE_RPC_METHODS as SubstrateContractMethods,
  SUBSTRATE_RPC_WS_PATH as SubstrateContractWsPath,
} from "@cozea/substrate-contracts";
import {
  SubstrateChatClient as SubstrateClientChatClient,
  readSubstrateRpcChatFlags as substrateClientFlags,
} from "@cozea/substrate-client-runtime";

describe("phase 7 substrate package alignment", () => {
  it("re-exports contracts surface from @cozea/substrate-contracts", () => {
    expect(SubstrateContractWsPath).toBe(ContractWsPath);
    expect(SubstrateContractMethods.chatSend).toBe(ContractMethods.chatSend);
    expect(SubstrateContractMethods.health).toBe("health");
  });

  it("re-exports client-runtime surface from @cozea/substrate-client-runtime", () => {
    expect(substrateClientFlags({}).enabled).toBe(true);
    expect(clientRuntimeFlags({ COZEA_SUBSTRATE_RPC_CHAT: "0" }).enabled).toBe(false);
    expect(typeof SubstrateClientChatClient).toBe("function");
    expect(typeof ClientRuntimeChatClient).toBe("function");
    expect(SubstrateClientChatClient.name).toBe(ClientRuntimeChatClient.name);
  });
});
