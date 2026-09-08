# D22 — Pipelined perception and planning without conflicting writers

**Purpose:** overlap useful preparation with deterministic execution while preserving observation validity and human control. **Research basis:** programmable local execution [S44](29-research-register.md#s44); source/trace semantics in D07/D20. This pipeline is a Cozea design, not a claim that an in-progress model inference can automatically see live screen updates.

## 1. Allowed overlap

While the motor kernel executes a validated timeline, the evidence service may gather permitted next-state context and the worker may perform pure computation. The host may schedule explicitly authorized nonconflicting model planning against a versioned observation. Only one authority-bearing effect stream exists per seat.

Do not run two independent agents that both assume they own keyboard focus. Do not execute a speculative branch that might submit data before the model selects it. The permitted speculation is computation, evidence preparation and a prepared-but-not-admitted plan, never irreversible GUI effects.

## 2. Plan segment contract

A `PreparedPlan` contains source/geometry digest, required capability set, target dependencies, assumed observation IDs, predicted next inputs, cost estimate, expiry and permitted rebinding policy. Preparing a plan may resolve evidence and compile timelines but does not hold buttons or post events. Admission revalidates every relevant dependency and current control epoch.

If a prepared target is no longer valid, return a dependency failure and selected new evidence. Do not silently move an old coordinate to a visually similar control. A model may authorize a selector-based reacquisition with explicit uniqueness/semantic checks; record the new binding before admission.

## 3. Pipeline scheduler

Represent the task as a DAG of pure compute, evidence-read, model-decision, preparation, effect and verification nodes. Dependencies specify exact evidence/operation IDs. The scheduler can overlap nodes whose read/write resources do not conflict, prioritizing urgent control and upcoming evidence over speculative bulk work.

Initial policy permits at most one speculative model planning branch and two evidence prefetches per active control. Additional concurrency is host-configurable after resource/cost measurement. Cancelling a branch cancels its owned child work and releases artifacts; it does not cancel the committed main execution unless shared authority was explicitly revoked.

A model provider that cannot receive new observations mid-generation works through explicit checkpoints. The scheduler may prepare the next packet while inference is running, but it does not pretend that packet influenced the already-running inference. Record which exact observation revision each model output used.

## 4. Avoiding stale-plan cascades

Separate stable assumptions (application identity, selected document) from volatile ones (button coordinates, current menu, playback state). Plans declare those dependencies so a harmless status update does not discard all computation. Conversely, navigation or mode change must invalidate the relevant prepared branch even when screenshots look similar.

A plan that repeatedly invalidates should fall back to a smaller next-action horizon, not continuously generate longer speculative programs. The horizon is adaptive to measured uncertainty/application responsiveness and may be extended for a stable canvas. That is a scheduling decision, not a new task-specific macro.

## 5. Evidence prefetch

Prefetch only within approved capture/export scope. Warm local evidence does not automatically go to the provider. Crops/AX subtrees can be prepared and deduplicated; emit only when a decision needs them. Checkpoint image freshness is evaluated at emission and resume, not at initial prefetch time alone.

Do not prefetch every window at full resolution. D09 memory and owner budgets apply. An artifact never silently outlives its privacy retention because a speculative plan references it. Expired evidence makes the plan nonadmissible until refreshed.

## 6. Cozea integration

Add `PlanningCoordinator` and `PreparedPlanRegistry` to AidHost, consuming the existing orchestration/provider adapters rather than directly calling provider APIs with new credentials. Use explicit task budgets for inference cost; unlimited development budget does not imply unbounded runtime user API spending. The controlling model remains authoritative; helper inference, if ever added, is separately named/approved and never implicit in this version.

Keep state visible through the supervision panel: executing, preparing next evidence, waiting for model, or cancelling speculative work. Do not expose hidden chain-of-thought; show executable plans, chosen actions and observable dependencies.

## 7. Qualification

Compare no-pipeline and pipeline runs with identical tasks, observation requirements and native timing. Measure time saved on the critical path, extra model tokens, discarded-plan rate, memory/CPU and correctness. A faster average with more wrong-window effects is a failure. Large speculative costs without latency benefit should disable the profile.

**PIPE-01:** at most one seat writer despite multiple planning branches. **PIPE-02:** prepared plans have no effects before admission. **PIPE-03:** stale observation/epoch rejects a branch. **PIPE-04:** unrelated value changes preserve valid pure work. **PIPE-05:** cancelled branches release only their resources. **PIPE-06:** exact inference input observation IDs are recorded. **PIPE-07:** provider without streaming observations remains truthful. **PIPE-08:** benchmarks report extra cost and discarded work. This is an optimization after core correctness, not a prerequisite for basic fast local sequencing.
