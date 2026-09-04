import type { ProviderOptionDescriptor } from "@cozea/assistant-contracts";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

/** Values injected through prompt text are not directly selectable provider options. */
export function getDirectlySelectableOptions(descriptor: SelectDescriptor) {
  const promptInjectedValues = descriptor.promptInjectedValues;
  if (!promptInjectedValues || promptInjectedValues.length === 0) {
    return descriptor.options;
  }

  return descriptor.options.filter((option) => !promptInjectedValues.includes(option.id));
}
