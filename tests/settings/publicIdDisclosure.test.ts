import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PublicIdDisclosure } from "@/features/settings/ui/PublicIdDisclosure"

describe("PublicIdDisclosure", () => {
  it("keeps the ID out of the rendered page until the user reveals it", () => {
    const publicId = "czd_test_public_device_id"
    const markup = renderToStaticMarkup(
      createElement(PublicIdDisclosure, {
        value: publicId,
        label: "Device ID",
      }),
    )

    expect(markup).toContain("Show ID")
    expect(markup).not.toContain("ID hidden")
    expect(markup).not.toContain(publicId)
    expect(markup).not.toContain(">Copy<")
  })
})
