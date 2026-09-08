# Desktop Performance Runbook

This runbook is the canonical loop for keeping Cozea feeling like a fast desktop app instead of a web page with loading states.

## Goals

- Cold boot paints native chrome quickly.
- Workspace switching keeps the previous visible UI stable while the next workspace catches up.
- Opening and restoring tiles avoids long main-thread stalls.
- Background terminals, dev servers, agents, and sync continue running when they are real work.
- Passive background UI is budgeted so old projects do not quietly consume renderer/runtime resources forever.

## Setup

1. Start the app with performance diagnostics:
   - `bun run dev:perf:modern`
2. For baseline comparison:
   - `bun run dev:perf:baseline`
3. Open renderer DevTools and keep the Performance panel ready.
4. Keep console output visible for `[BootTiming]`, `[Jank][LoAF]`, and `[Jank][LongTask]` entries.
5. Summarize saved Chrome traces with:
   - `bun run perf:trace-summary -- tmp/cozea-cold-boot-trace.json.json.gz`
6. After production builds, summarize renderer chunk weight with:
   - `bun run perf:bundle-summary`
7. For the LegendList agent timeline experiment, enable optional list diagnostics in DevTools:
   - `localStorage.setItem("cozea:legend-list-agent-timeline:debug", "1")`
   - Recycling is enabled by default and can be disabled with `localStorage.setItem("cozea:legend-list-agent-timeline:recycle", "0")`.

## Capture Scenarios

1. Cold boot:
   - Start from no running Electron process.
   - Record until the first workspace is interactive.
   - Compare `cozea:renderer:entry-to-first-frame` and `[BootTiming] main-window-ready-to-show`.
2. Rapid workspace switching:
   - Switch through at least five projects, including one project with restored tiles.
   - Watch `cozea:interaction:project-switch` measures.
   - Confirm old workspace UI does not flash a full-page loading state.
3. Tile opening:
   - Open Browser, Terminal, Dev Server, Mobile Simulator, and an assistant tile.
   - Watch `cozea:interaction:workbench-add-tile` and `cozea:interaction:workbench-open-singleton-tile`.
4. Tile restore:
   - Relaunch into a project with multiple saved tiles.
   - Watch `cozea:interaction:workbench-restore-tiles`.
5. Background multitasking:
   - Leave a terminal, dev server, or assistant running.
   - Switch away for several minutes.
   - Confirm the process stays active while passive warm workspaces are capped by the runtime host policy.

## What To Compare

- Main-process boot timings.
- Renderer first-frame timing.
- Long animation frames over 50ms, especially those with script attribution.
- Long tasks over 50ms.
- Workspace host count and which workspaces remain hosted.
- Whether background work kept running without keeping every background UI surface alive.
- Renderer entry chunk gzip size, largest async chunk, and whether heavy code-highlighting/workbench chunks stayed off the startup path.

## Reporting Format

For each run, include:

- Git commit hash.
- Date/time and OS.
- Electron version.
- Scenario name.
- Largest LoAF and LongTask durations.
- Notable `cozea:*` measures from the Performance panel.
- Whether any visible loading fallback appeared during project switch or tile restore.
