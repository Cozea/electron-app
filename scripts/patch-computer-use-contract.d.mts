export interface ComputerUseToolDefinition {
  name: string;
  description: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
    [keyword: string]: unknown;
  };
}
export const computerUseCatalogue: {
  tools: ComputerUseToolDefinition[];
  [key: string]: unknown;
};
export function patchComputerUseContract(source: string): { source: string; changed: boolean };
