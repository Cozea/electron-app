export interface ComputerUseToolContract {
  name: string;
  description: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: {
    additionalProperties?: boolean;
    properties: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export const computerUseCatalogue: { tools: ComputerUseToolContract[] };
export function patchComputerUseContract(source: string): {
  source: string;
  changed: boolean;
};
