import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getDirectlySelectableOptions } from "../../../apps/desktop/src/features/assistant/chat/modelPickerOptions";

const pickerContent = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/ModelPickerContent.tsx",
  ),
  "utf8",
);
const pickerTrigger = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/ProviderModelPicker.tsx",
  ),
  "utf8",
);
const chatSurface = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
  ),
  "utf8",
);
const stylesheet = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/index.css"),
  "utf8",
);

describe("agent model picker layout", () => {
  it("opens models and capabilities directly from the compact trigger", () => {
    expect(pickerTrigger).toContain('toggleView("models")');
    expect(pickerTrigger).toContain('toggleView("capabilities")');
    expect(pickerTrigger).toContain("Select model. Current model:");
    expect(pickerTrigger).toContain("Adjust capabilities. Current");
  });

  it("uses a flat model list without the old search and pin chrome", () => {
    expect(pickerContent).toContain("Select model");
    expect(pickerContent).toContain('role="listbox"');
    expect(pickerContent).toContain('role="option"');
    expect(pickerContent).toMatch(
      /data-model-picker-model-list[\s\S]{0,160}app-scrollbar scroll-fade-y/,
    );
    expect(pickerContent).not.toContain("Search models...");
    expect(pickerContent).not.toContain("Pin model");
  });

  it("renders reasoning as an accessible discrete slider", () => {
    expect(pickerContent).toContain('className="model-picker-effort-slider');
    expect(pickerContent).toContain('type="range"');
    expect(pickerContent).toContain("aria-valuetext={selectedPrimaryOption?.label}");
  });

  it("does not render prompt-injected effort values as unreachable slider stops", () => {
    const options = getDirectlySelectableOptions({
      id: "effort",
      type: "select",
      label: "Reasoning",
      options: [
        { id: "max", label: "Max" },
        { id: "ultracode", label: "Ultracode" },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      promptInjectedValues: ["ultrathink"],
    });

    expect(options.map((option) => option.id)).toEqual(["max", "ultracode"]);
  });

  it("keeps both selector surfaces at the compact reference geometry", () => {
    expect(chatSurface).toContain("w-64 max-w-[95vw]");
    expect(pickerContent).toContain("Math.min(288");
    expect(pickerContent).toContain('className="relative mt-2 h-6"');
    expect(stylesheet).toContain("height: 24px;");
    expect(stylesheet).toContain("width: 28px;");
  });
});
