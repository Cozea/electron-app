# D09 — Turn-owned capture, frame freshness and artifact transport

**Purpose:** keep sensors warm while control is active, export only requested evidence, and stop recording deterministically. **Baseline:** `CaptureRuntime.swift` currently owns entries and owner sets but expires unused screenshot requests after 15 seconds without consulting ownership. **Sources:** [S13–S15](29-research-register.md#s13), optional [S42–S43](29-research-register.md#s42).

## 1. Four separate responsibilities

Frame production, frame retention, image encoding and provider emission must have distinct APIs and metrics. Starting a stream does not mean sending video to the model. Keeping a latest frame does not grant unlimited history retention. Encoding an image does not grant permission to export it outside the device.

`CaptureRegistry` owns identity-bound streams. `FrameStore` owns immutable pixel-buffer references and metadata. `ImageService` creates cropped/scaled/redacted encodings. `ArtifactBroker` supplies bounded authorized artifact reads and provider export. The guest receives descriptors, not arbitrary IOSurface IDs, native pointers or filesystem paths.

## 2. Ownership and admission

A capture entry is keyed by seat/runtime generation, process launch identity, window ID/generation and capture configuration generation. Track active owners separately from in-flight readers. An owner is an active control or explicitly approved observation/watch scope. When the last reader finishes, do **not** stop an owned stream or schedule the old 15-second expiry.

When no owner remains, stop immediately after outstanding safe reads drain; a short unowned reuse grace is permitted only if the privacy UI accurately reports recording. The initial policy is no grace at logical control end. Abandoned control is handled by D05 host liveness, not by screenshot frequency.

Resource admission accounts for pixel buffers, stream queue depth, encoding work and pinned observations. Initial budget: 256 MiB retained capture/frame memory and two actively high-rate windows, with additional low-rate scopes admitted only within the measured profile. These are configuration values, not a rule to silently evict an active third window. Return `CAPTURE_CAPACITY` with explicitly releasable scopes or request a lower-rate/size plan. A newly admitted owner must never cause another actively pinned owner to disappear without an explicit suspension event.

## 3. Stream lifecycle

States: `creating`, `starting`, `running`, `reconfiguring`, `stopping`, `stopped`, `failed`. Each asynchronous transition carries entry ID and generation so late completion cannot revive an evicted stream. Startup tasks are shared among concurrent readers of the same entry; cancellation of one reader does not cancel another owner's startup.

A geometry/source change creates a new configuration generation. A stream may use supported configuration updates, but all frames carry the generation effective at acquisition. Do not relabel in-flight old-window frames as the new target. Retargeting to an unrelated window creates a distinct entry/sink; identity correctness is more important than avoiding one startup.

ScreenCaptureKit's own output queue and our retained latest frame are different. Start with the documented queue depth of three; never set an unbounded queue. Apple advises against exceeding eight. Retain at most the latest complete source frame plus bounded reader references. Slow encoders must not retain every incoming frame. [S14](29-research-register.md#s14).

## 4. Frame provenance and clocks

Each frame record contains source identities, stream/configuration generation, pixel dimensions/format, content rect and scale, capture/display timestamp in its documented clock domain, local callback receipt time, frame status and a monotonic frame sequence. Calibrate platform clock conversion at startup and after sleep; store conversion parameters and error bounds. Never treat an unspecified `displayTime` number as nanoseconds without validating SDK semantics.

`complete` means a new complete image can replace the cached frame. `idle` indicates the source did not produce a newly changed image under the documented stream behavior; it is not automatically a new pixel buffer. Blank, suspended, stopped and failed statuses are represented explicitly. Do not encode invalid buffers or silently return an unrelated previous source.

For a request after operation N, return the latest frame whose capture-time evidence and stream generation satisfy the requested barrier. If the stream reports valid unchanged-state evidence after N, that can support a fresh unchanged observation with the original pixel frame ID and a newer **evidence** timestamp. Do not increment pixel frame identity to pretend pixels were recaptured. For navigation, modal appearance or uncertain delivery, a short unchanged interval does not establish that the task completed; the result stays unverified.

Wait up to 150 ms for suitable evidence under the normal profile, then use a bounded one-shot provider if available and authorized. If neither establishes freshness, return stale/partial evidence explicitly. A conservative read may be slower; it must not falsify the observation chronology.

## 5. Attention and configuration

Observe options select overview maximum dimension (initial 1280), detail regions at justified native resolution, SDR output by default, image format, cursor/overlay inclusion and pixel budget. The human-visible cursor stays on screen. Exclude Cozea-owned overlay windows from desktop capture/diff providers where supported; identify them by owned window IDs rather than subtracting arbitrary cursor-shaped pixels.

Region observation should crop from a valid retained frame when possible. All cropped outputs carry source crop rect and image-to-window transform. Configure the stream near the needed steady-state resolution; requesting a high-detail crop may require a higher-resolution source or one-shot acquisition. Upscaling an already small frame is not high-detail evidence and must be labelled as such.

Use low-rate capture for inactive watched regions and a qualified active rate for gesture tracking. Rate changes require explicit configuration generations but do not revoke a surface merely because image encoding size changed. Default 15 fps is suitable for context; active visual servo rate is independently qualified in D10. Do not claim a 15 fps sensor can detect arbitrary 60 Hz target motion reliably.

## 6. Encoding and artifacts

Encoding cache key: exact pixel frame ID, crop transform, output dimensions, format/quality, colorspace and redaction policy version. Cache PNG for text-critical/lossless details; JPEG may be selected for overviews when a provider supports it and fixtures show acceptable grounding. Do not use repeated encode-shrink loops without a bound. Estimate size/resize once, encode, then at most one explicitly recorded fallback if the byte budget is exceeded.

The default emitted-image budget is 3 MiB per image and 8 MiB per observation bundle, subject to the provider's lower limit. `ArtifactDescriptor` contains ID, MIME, byte count, digest, dimensions, provenance and expiry; it is not a URL the guest can use for arbitrary fetch. Internal transfer uses bounded binary chunks on the data channel, with credit/backpressure and cancellation. Validate digest before publishing a completed artifact. Provider-specific base64 is done once at the outer adapter that needs it.

Raw frames remain trusted-service resources. Approved local pixel routines may request a bounded crop buffer through a copied/readonly artifact view. That permission is distinct from network export. No ambient screenshot directory is mounted into the guest.

## 7. Teardown and privacy

Permission loss, locked session, control revoke, normal logical task completion and host-liveness expiry stop further acquisition and release the appropriate owners. In-flight callbacks check generation and cannot republish frames after reset. Exports already sent cannot be retracted; local retention cleanup is not represented as remote deletion.

Temporal clips are opt-in. Default history is latest-frame only; debugging retention requires visible consent, duration/byte limits and explicit artifact export. Newer one-shot APIs and beta clip buffering are providers behind availability checks, not required baseline dependencies. Do not make a macOS 14 build reference new symbols unguarded or claim beta clip support is shipped.

## 8. Implementation and acceptance

Refactor existing `CaptureRuntime`, `WindowStream`, image encoding and diagnostics into the four owners above. Preserve the preflight permission checks, bounded fallback and source identity validation. Add generation/owner lifecycle tests before changing rates.

**CAP-01:** same stream survives 60 seconds of valid task activity without screenshots. **CAP-02:** no owner means deterministic stop; another owner's release does not interrupt remaining owners. **CAP-03:** capacity cannot silently evict an active stream. **CAP-04:** late startup/frame callback after reset is ignored and stopped. **CAP-05:** unchanged/idle evidence is distinguished from a new image and from stale evidence. **CAP-06:** crop transforms and mixed-scale capture match input geometry. **CAP-07:** exactly requested encodings/exports occur, none after ordinary actions. **CAP-08:** capture stop on revoke/sleep/host loss is measured. **CAP-09:** sharing UI never changes the bound source. **CAP-10:** slow consumer, OOM and encoder cancellation remain bounded. Gate G05 includes actual signed-app permissions and recorded stream starts/stops.
