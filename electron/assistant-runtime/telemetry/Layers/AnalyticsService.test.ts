// @ts-nocheck
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { AnalyticsService } from "../Services/AnalyticsService.ts";
import { AnalyticsServiceLayerLive } from "./AnalyticsService.ts";

it.effect("AnalyticsServiceLayerLive is a no-op service", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService;
    yield* analytics.record("runtime.started", { surface: "desktop" });
    yield* analytics.flush;
    assert.equal(typeof analytics.record, "function");
  }).pipe(Effect.provide(AnalyticsServiceLayerLive)),
);
