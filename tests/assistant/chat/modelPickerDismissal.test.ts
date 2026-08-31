import { describe, expect, it } from "vitest"
import { shouldDismissModelPickerOnPointerDown } from "../../../apps/desktop/src/features/projects/components/assistant/chat/modelPickerDismissal"

describe("model picker outside-pointer dismissal", () => {
  const panel = new EventTarget()
  const trigger = new EventTarget()

  it("keeps the picker open for pointer events inside the panel", () => {
    expect(
      shouldDismissModelPickerOnPointerDown({
        eventPath: [new EventTarget(), panel],
        panel,
        trigger,
      }),
    ).toBe(false)
  })

  it("lets the trigger own its open-state toggle", () => {
    expect(
      shouldDismissModelPickerOnPointerDown({
        eventPath: [trigger],
        panel,
        trigger,
      }),
    ).toBe(false)
  })

  it("dismisses the picker for pointer events outside both regions", () => {
    expect(
      shouldDismissModelPickerOnPointerDown({
        eventPath: [new EventTarget()],
        panel,
        trigger,
      }),
    ).toBe(true)
  })
})
