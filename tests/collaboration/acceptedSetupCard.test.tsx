import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AcceptedSetupCard } from "@/features/inbox/pages/InboxPage"

const render = (props: Partial<Parameters<typeof AcceptedSetupCard>[0]> = {}) =>
  renderToStaticMarkup(
    <AcceptedSetupCard
      projectName="Moliere App"
      detail={null}
      acceptedLabel="Invitation accepted"
      openLabel="Open project"
      onOpen={vi.fn()}
      {...props}
    />,
  )

describe("S10 accepted-invitation setup card", () => {
  it("offers Retry setup after a failed bootstrap and keeps the project context", () => {
    const markup = render({
      detail: "You're in the live session, but its Session Workbench was not prepared.",
      retryLabel: "Retry setup",
      canRetry: true,
      onRetry: vi.fn(),
    })
    expect(markup).toContain("Moliere App")
    expect(markup).toContain("Retry setup")
    expect(markup).toContain("Open project")
  })

  it("hides Retry setup once the workbench is ready", () => {
    const markup = render({ detail: "Your Session Workbench is ready to open.", canRetry: false })
    expect(markup).not.toContain("Retry setup")
    expect(markup).toContain("Open project")
  })

  it("disables actions while a setup attempt is running", () => {
    const markup = render({ settingUp: true, canRetry: true, retryLabel: "Retry setup", onRetry: vi.fn() })
    expect(markup).toContain("disabled")
  })
})
