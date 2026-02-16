# Dashboard Performance Runbook

This runbook is the canonical way to profile dashboard jank in development.

## Scope

Target pages:
- `/projects`
- `/teams`
- `/workspace/billing`
- `/workspace/ai`
- `/workspace/sync`

Primary warnings:
- `[Violation] 'message' handler took ...`
- `[Violation] Forced reflow while executing JavaScript took ...`

## Setup

1. Start app in dev mode:
   - Modernized run: `npm run dev:perf:modern`
   - Baseline run: `npm run dev:perf:baseline`
2. Open Chrome DevTools for the renderer window.
3. Ensure verbose logs are visible (do not filter out warnings).
4. Run both modes with the same script below and compare warning counts.

## Capture Procedure

1. Open Performance panel.
2. Enable screenshots and JS sampling.
3. Start recording.
4. Navigate pages in this exact sequence:
   - Projects -> Members -> Billing -> AI -> Sync -> Projects
5. On each page:
   - Wait 3 seconds after load.
   - Trigger one interaction (sort/filter/open menu where available).
6. Stop recording after returning to Projects.

## What To Compare

- Count of message-handler violations.
- Count of forced reflow violations.
- Long tasks over 50ms.
- LoAF console output (when enabled).

## Reporting Format

For each run, include:
- Git commit hash
- Date/time
- Environment (OS, Electron version)
- Warning counts by page
- Largest long task duration
