# D24 — Human demonstrations as evidence for program synthesis

**Purpose:** let a person teach unfamiliar UI procedures while keeping demonstrations distinct from privileged macros. **Research:** model-generated policy/program techniques [S46](29-research-register.md#s46) support the general direction; no source proves Cozea can safely generalize arbitrary demonstrations. **Depends on:** D07, D13, D19, D21 and D23.

## 1. Recording contract

A demonstration begins only after explicit local consent specifying seat, applications/regions, duration, input categories, retained evidence and export destination. The recorder captures human input and corresponding authorized observations; it does not assume the model can see every step unless evidence is supplied. Default recording excludes secure text/clipboard values and unrelated desktop regions.

Record timestamped pointer/key transitions, focus/window changes, relevant AX/pixel evidence, and optional human annotations explaining intent. Separate raw low-level input from inferred semantic steps. An observed click on a Save button may suggest an intent; it is not proof that every future Save-looking control has the same meaning.

## 2. Data model

A `Demonstration` contains ID, consent/grant version, source environment, start/end, redaction/coverage, ordered input/evidence events, human annotations and an optional derived procedure. Raw evidence is immutable and privacy-expiring. The derived program has its own version, provenance and qualification status.

Passwords or other redacted inputs become explicit parameter placeholders, never guessed values reconstructed from event timing or screenshots. A failure/gap during recording is represented, not interpolated into a supposedly complete successful procedure.

## 3. Segmentation and synthesis

A local segmenter groups input into candidate interactions (click, drag, shortcut, text burst) using timing and observed UI changes. It does not execute anything. The model receives selected segments/evidence and produces a general JavaScript procedure with explicit parameters, current-state acquisition, selectors/anchors, conditions and checkpoints.

The system must discourage fragile absolute coordinate replay by exposing region/window transforms and semantic evidence. However, it must not automatically invent semantic selectors absent from the demonstration. A purely visual control can use an observed surface/landmark contract with disclosed uncertainty.

The synthesized program is reviewed as untrusted source and executed in the ordinary sandbox/grants. Recording permission does not grant replay permission. The person chooses a test target/fixture before live trial.

## 4. Verification and promotion

First run offline replay against recorded observations to validate control flow and required parameters. Then run a controlled fixture or disposable app state with actual AID input. Finally qualify the intended app/environment, including layout changes and ambiguous alternatives. A program passing the recorded path only is labelled demonstration-specific, not reusable.

Successful generalization should reacquire targets on changed window placement, tolerate irrelevant status updates and stop on a different dialog. It should not silently complete through terminal/file APIs when GUI replay fails. Save to procedural memory through D21 promotion, including the demonstration provenance and any private-data exclusions.

## 5. Privacy and user takeover

Demonstration input may contain the person's most sensitive data. Show a recording indicator, stop shortcut and selected regions throughout. Stop immediately on secure-field detection where supported or an explicit pause. Unknown secure coverage is disclosed. Do not record microphone/audio by default.

Local retention defaults to the current teaching session; keeping a clip or sharing a derived skill requires explicit action. Export derived source only after reviewing embedded literal text/paths and redactions. Deleting the local demonstration cannot retract data already supplied to a provider.

A demonstration is human-owned interaction: no agent input executes concurrently on the same seat. AID control is released before recording begins, and reacquired only for an explicitly requested test. Do not combine user and agent button state into an ambiguous recording.

## 6. Implementation and tests

Implement native `DemonstrationRecorder` using the qualified input-observation monitor, host `DemonstrationStore`/`Segmenter`/`SynthesisCoordinator`, and a teaching UI integrated into the existing assistant workflow. Use the normal provider orchestration for synthesis; no undocumented hidden model service. Keep raw input-monitor capabilities separate from agent actuation.

**DEMO-01:** explicit consent precedes any recording. **DEMO-02:** no simultaneous agent writer. **DEMO-03:** redacted text becomes parameters and is not exported. **DEMO-04:** missing evidence is marked. **DEMO-05:** synthesized code cannot escape grants/sandbox. **DEMO-06:** coordinate-dependent program fails or rebinds explicitly when layout changes. **DEMO-07:** offline pass is not labelled live qualification. **DEMO-08:** recording cancellation and retention expiry remove local artifacts. **DEMO-09:** skill promotion preserves provenance without private payloads. **DEMO-10:** a person can inspect what was recorded and exported.
