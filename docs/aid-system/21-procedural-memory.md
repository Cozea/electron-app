# D21 — Agent-authored skill modules and procedural memory

**Purpose:** let an agent retain successful procedures without turning the native runtime into a fixed catalogue of tasks. **Cozea seam:** the existing local `/projects/skills` library and `docs/agent-skills.md`; provider-native folders remain execution authority for existing provider skills. **Research:** code-execution/helper reuse [S41](29-research-register.md#s41), policy-code generation [S53](29-research-register.md#s53). Neither source demonstrates automatic safe GUI generalization.

## 1. Skill artifact

A skill is source plus a manifest, not a saved live handle or privileged plugin. Manifest contains ID/version, source digest, author/provenance, parameter schema, return schema, required capabilities/modes, supported app/environment profiles, expected preconditions, observed success evidence, tests, privacy classification and dependencies pinned by digest.

General helpers such as geometry need no desktop authority. A task procedure may request pointer/keyboard/window capabilities at execution time but cannot carry a grant from its authoring session. Source modules must have pure initialization: importing a reusable skill cannot automatically click or type. An exported function performs effects only when explicitly invoked in a current execution.

## 2. Lifecycle

States: draft, tested-in-fixture, tested-live-profile, approved-local, shared, deprecated and revoked. One successful run is evidence, not universal qualification. Promotion requires explicit host/user policy and a privacy review that strips private content, paths, tokens and native IDs. Sharing to another project/organization is an export and cannot happen merely because the model called a save helper.

`aid.workspace.saveModule(name, revision)` retains an admitted pure module revision in the current workspace. Its source hash and profile assumptions come from the host-owned module manifest; richer skill metadata is authored through the separate host-mediated publishing flow. Publishing to Cozea's skill library is a host-mediated operation requiring approval. The existing managed-copy rules remain: do not overwrite an unmarked provider skill folder or silently replace external content. AID skills can be referenced by the existing library UI through a distinct runtime-kind field, not disguised as a provider-native skill format.

## 3. Reuse and adaptation

On invocation, validate parameter schema, current capabilities, app/version/layout profile and preconditions. Reacquire app/window/element/surface handles from current evidence. Stored screen coordinates without a transform/anchor procedure are example data, not execution authority. A selector matching multiple items returns an ambiguity for the calling program/model.

The model may adapt a helper when the UI changes. That creates a new source/version and qualification record, rather than mutating a previously approved artifact in place. Learning records summarize what changed and which evidence supports the adaptation. The runtime never silently updates all users' helpers from one speculative model edit.

## 4. Retrieval and context

Expose a compact semantic index of approved skill descriptions, capabilities and qualification envelope. Retrieve relevant manifests first, source/docs on demand. This is progressive disclosure, not a giant instruction bundle in every model prompt. A skill's description is untrusted third-party text until reviewed; it cannot override user task or permissions.

Useful experience records include successful parameter ranges, precondition failures, known unavailable controls and measured operation counts. Do not persist hidden model reasoning. Store emitted code, supplied rationale and observed execution evidence only. Statistics must distinguish real live runs from offline replay.

## 5. Tests and sandbox

Every reused module executes in the same restricted worker/SDK. There are no arbitrary npm/native dependencies. Dependencies are vetted pure modules or separately declared host capabilities. A malicious imported helper cannot get more authority than the caller's grant. Guest inspection of exports avoids invoking getters or arbitrary initialization beyond the approved pure import.

Test manifest/source digest mismatch, effectful import attempts, missing grants, stale handles embedded in data, private strings in exports, ambiguous targets and revoked shared versions. A revoked skill cannot be automatically substituted by a different version; the host asks for an explicit update.

## 6. Implementation

Add `packages/aid-host/src/skills/{SkillManifest,SkillRegistry,SkillPromotion,QualificationLookup}` and a runtime-kind adapter to the current skill library. Store drafts in local userData and approved immutable source by digest. Keep provider copy/export pipelines separate until a real public package format is selected. Cloud synchronization is optional future product policy, not a prerequisite for local procedural memory.

**SKILL-01:** import does not cause desktop effects. **SKILL-02:** every execution reacquires live authority/targets. **SKILL-03:** source/profile changes create new version. **SKILL-04:** cross-project publication requires approval and strips private data. **SKILL-05:** external provider skills are not overwritten. **SKILL-06:** unqualified environments are disclosed. **SKILL-07:** sandbox/grants cannot be expanded through dependencies. **SKILL-08:** retrieval returns provenance and failures, not only success anecdotes. This extension follows core execution qualification; it must not mask missing device capabilities with hard-coded native tasks.
