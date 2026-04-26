import { CommandId, type ProviderRuntimeEvent } from "@cozea/assistant-contracts";

export function serverCommandId(tag: string): CommandId {
  return CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
}

export function providerCommandId(event: ProviderRuntimeEvent, tag: string): CommandId {
  return CommandId.makeUnsafe(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`);
}
