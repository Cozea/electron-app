interface ModelPickerDismissalTargets {
  eventPath: ReadonlyArray<EventTarget>
  panel: EventTarget | null
  trigger: EventTarget | null
}

export function shouldDismissModelPickerOnPointerDown({
  eventPath,
  panel,
  trigger,
}: ModelPickerDismissalTargets): boolean {
  const isInsidePanel = panel !== null && eventPath.includes(panel)
  const isInsideTrigger = trigger !== null && eventPath.includes(trigger)

  return !isInsidePanel && !isInsideTrigger
}
