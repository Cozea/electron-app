# Cozea AI Behavior Contract

This document defines runtime behavior that must remain stable across provider/auth changes.

## 1) Wizard Conversation (`feature: project-wizard`)

- Purpose: requirements elicitation and plan generation.
- Prompt source: `PROJECT_WIZARD_SYSTEM_PROMPT` only.
- Context ingestion:
  - User conversation state.
  - No project filesystem context.
- Tool behavior:
  - Must produce plan output through `present_plans`.
  - Planning phase is read-focused and web-research capable.
  - No project write/terminal execution.

## 2) Builder Execution (`feature: project-builder`)

- Purpose: execute approved build plan and emit progress.
- Prompt source: `PROJECT_BUILDER_SYSTEM_PROMPT` only.
- Context ingestion:
  - Approved plan payload and build task state.
  - Active project path.
- Tool behavior:
  - Requires local coding tools for file creation/editing and build commands.
  - Must maintain progress updates via `build_tasks`.
  - Local tool execution stays project-scoped.

## 3) Project Assistant (`feature: assistant`)

- Purpose: project help, debugging, implementation, and Q&A.
- Prompt source: `PROJECT_ASSISTANT_SYSTEM_PROMPT`.
- Context ingestion:
  - In-project: append current page + inspected element + project metadata.
  - Outside project: no project context payload.

### 3.1 In-project assistant

- Local write and terminal tools are allowed.
- Tool paths are project-root relative.

### 3.2 Outside-project assistant

- Only read-only local tools are allowed:
  - `read_file`
  - `list_dir`
  - `file_search`
  - `grep_search`
- All non-read tools must be rejected before execution.
- Read-only tools are anchored to a safe directory and must not default to app source root.

## 4) Provider Adaptation Boundary

- Provider adapters may transform request format, headers, and model-specific options.
- Provider adapters must not change:
  - Feature routing (wizard/builder/assistant),
  - Tool permission/scoping,
  - Context ingestion rules.

## 5) Error Taxonomy (UI-facing)

- `provider_auth_required`
- `provider_restricted`
- `model_restricted`
- `entitlement_required`
- `feature_unavailable`

These errors should carry actionable title/message and (when relevant) recovery action metadata.
