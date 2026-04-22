# T3 Code Integration & Updates Summary

This document outlines the major architectural changes, new features, and package updates recently introduced in the upstream `t3code` repository. It serves as a reference for components and paradigms we can migrate or adapt into the Cozea application.

## 1. Agent Context Protocol (ACP) & New Providers
The system has introduced first-class support for the **Agent Context Protocol (ACP)** via a massive new `packages/effect-acp` package.
- **New Adapters:** Native adapters for **Cursor** (`CursorAcpSupport`, `CursorProvider`) and a brand new **Opencode** provider (`OpenCodeProvider`, `opencodeRuntime.ts`) have been added.
- **Model Updates:** Support for Claude Opus 4.5 and Claude Opus 4.7 have been introduced into the built-in model registry.
- **Launch Args:** Added configurable launch arguments for the Claude provider.

## 2. New Observability Engine (OTLP & Tracing)
A completely overhauled observability and telemetry system has replaced flat console logging on the backend.
- **NDJSON Traces:** Completed spans are written as structured NDJSON records to the local filesystem (default: `~/.t3/userdata/logs/server.trace.ndjson`).
- **OTLP Export:** The server can now export traces and metrics directly to an OpenTelemetry (OTLP) backend like a local Grafana LGTM stack (Tempo/Prometheus) using environment variables (e.g., `T3CODE_OTLP_TRACES_URL`, `T3CODE_OTLP_SERVICE_NAME`).
- **Effect Integration:** The system relies entirely on `Effect.log...` and `Effect.withSpan` for boundary tracing, avoiding ad-hoc console statements. Detailed span annotations now handle high-cardinality context (like paths and UUIDs) while keeping metrics clean.

## 3. "Remote-First" Architecture
A new domain model to support remote execution seamlessly was introduced (documented in `.docs/remote-architecture.md`). 
- **The Execution Boundary:** The T3 server now strictly acts as the remote execution boundary.
- **Connection Models:** The frontend can connect to the server via multiple access endpoints:
  - `ExecutionEnvironment` (The running server)
  - `KnownEnvironment` (A saved client-side entry/profile)
  - `AccessEndpoint` (Direct WebSocket, Tunneled WebSocket, or Desktop-managed SSH).
- This structure paves the way for running the backend on a remote server while connecting via the desktop app, keeping the execution layer decoupled from the UI.

## 4. Backend Restructuring & Node-Native TypeScript
- **Native TypeScript:** Adopted Node-native TypeScript execution (`node --run`) for both the desktop and server environments, dropping older bundler overhead and improving startup times.
- **Server Refactor:** The `apps/server/src` directory underwent a massive reorganization into strict Domain Driven Design (DDD) layers. Code is now split into modularized directories like:
  - `auth/` (Control plane, sessions, secrets)
  - `environment/` (Server environments and labels)
  - `git/` (Status broadcasting, hooks)
  - `observability/` (Trace sinks, metric definitions)
  - `orchestration/` (Thread deletion reactors, normalizers)
  - `project/` (Favicon resolvers, script runners)
  - `provider/` (ACP adapters, cursor support)

## 5. Frontend & UI Improvements
- **Chat & Composer:** Huge refactors to `ChatComposer.tsx`, `MessagesTimeline.tsx`, and the introduction of a new `CommandPalette` that now visually shows thread statuses.
- **Terminal Shortcuts:** Keybindings for the terminal now bypass `xterm` so global shortcuts (like `CTRL+J` to toggle the terminal) work reliably regardless of window focus.
- **Sidebar & Projects:** 
  - Added configurable project grouping for the sidebar.
  - Implemented a filesystem browse API and a command palette project picker.
  - Fixed issues regarding deleting non-empty projects from warning toasts.
  - Made the plan sidebar responsive to prevent composer controls from overlapping on narrow windows.

## 6. Build, Release, & CI Modernization
- **Release Workflows:** Modernized the GitHub release workflow runners to `ubuntu-24.04`, added nightly release throttling (every 3 hours), and integrated Blacksmith for testing releases.
- **Platform Support:** Extended support to build for Windows ARM and fixed Windows PATH hydration and repair issues.

---

*This file can be used as a roadmap for selecting which features (such as the ACP integration or the new Observability engine) to copy from `t3code` into this project.*