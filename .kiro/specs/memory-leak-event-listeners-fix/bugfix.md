# Bugfix Requirements Document

## Introduction

Event listeners are added to `window` and `window.visualViewport` objects in the native surface occlusion tracking system but can be registered multiple times without proper deduplication, causing memory leaks. When `ensureObservers()` is called multiple times (which happens during component mount/unmount cycles), duplicate event listeners accumulate on the global window objects. This leads to increasing memory usage, performance degradation from duplicate event handler executions, and potential browser instability in long-running sessions.

The bug affects the `ensureObservers()` function in `src/lib/nativeSurfaceOcclusion.ts` at lines 238-241, where event listeners are added without checking if they already exist.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `ensureObservers()` is called multiple times THEN the system adds duplicate event listeners to `window` and `window.visualViewport` for each call

1.2 WHEN components using native surface occlusion mount and unmount repeatedly THEN the system accumulates multiple copies of the same event listeners on global objects

1.3 WHEN duplicate event listeners accumulate THEN the system executes `scheduleOcclusionRefresh` multiple times for each resize or scroll event

1.4 WHEN the application runs for extended periods with repeated navigation THEN memory usage grows continuously due to unreleased event listener references

### Expected Behavior (Correct)

2.1 WHEN `ensureObservers()` is called multiple times THEN the system SHALL ensure event listeners are registered exactly once on `window` and `window.visualViewport`

2.2 WHEN components using native surface occlusion mount and unmount repeatedly THEN the system SHALL maintain only one set of event listeners on global objects

2.3 WHEN resize or scroll events occur THEN the system SHALL execute `scheduleOcclusionRefresh` exactly once per event

2.4 WHEN the application runs for extended periods with repeated navigation THEN memory usage SHALL remain stable with no listener accumulation

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the first registration occurs THEN the system SHALL CONTINUE TO initialize observers and add event listeners

3.2 WHEN all registrations are removed THEN the system SHALL CONTINUE TO clean up all observers and remove all event listeners via `cleanupObserversIfIdle()`

3.3 WHEN occlusion state changes are detected THEN the system SHALL CONTINUE TO trigger callbacks and update component state correctly

3.4 WHEN `MutationObserver`, `ResizeObserver`, and animation frame scheduling are used THEN the system SHALL CONTINUE TO function correctly with the same performance characteristics

3.5 WHEN `window.visualViewport` is undefined (in environments that don't support it) THEN the system SHALL CONTINUE TO handle this gracefully using optional chaining
