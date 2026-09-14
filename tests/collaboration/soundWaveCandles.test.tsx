import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SoundWaveCandles } from "@/features/collaboration/media/SoundWaveCandles"

describe("SoundWaveCandles audio visualizer", () => {
  it("renders 4 candle bars with resting 3px baseline dot styling", () => {
    const markup = renderToStaticMarkup(
      <SoundWaveCandles isMuted={false} />
    )

    expect(markup).toContain("data-soundwave-candles")
    expect(markup).toContain("--h0:3px")
    expect(markup).toContain("--h1:3px")
    expect(markup).toContain("--h2:3px")
    expect(markup).toContain("--h3:3px")
    // Should have 4 rounded-full spans
    const matches = markup.match(/rounded-full/g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(4)
  })

  it("renders resting baseline dots when isMuted is true", () => {
    const markup = renderToStaticMarkup(
      <SoundWaveCandles isMuted={true} />
    )
    expect(markup).toContain("data-soundwave-candles")
    expect(markup).toContain("--h0:3px")
    expect(markup).toContain("--h3:3px")
  })
})
