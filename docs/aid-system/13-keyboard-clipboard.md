# D13 — Text, physical keys, composition and explicit clipboard use

**Purpose:** provide a programmable keyboard with correct semantics, foreground recovery and no invisible fallback. **Baseline:** v2 keyboard posts to a PID and `type_text` requires a narrow list of AX editable roles. **Sources:** [S17](29-research-register.md#s17), [S18](29-research-register.md#s18), clipboard policy [S51](29-research-register.md#s51).

## 1. Separate operations

`typeText(text)` inserts literal Unicode using a qualified text-input route while preserving selection/caret. `chord(keys)` expresses a logical shortcut. `keyDown`/`keyUp` and timed holds express physical key transitions. `setValue` is a distinct semantic AX operation that replaces a specified attribute. `clipboard.writeText/writeImage` and `pasteText/pasteImage` are explicit optional device capabilities. None silently substitutes for another.

Typing a Unicode character is not equivalent to pressing its physical key on every layout. Physical key codes and logical names carry an explicit keyboard-layout profile. Unknown mappings fail before effects rather than defaulting to US layout. An IME may consume physical events through composition; Unicode injection does not claim to reproduce all IME behavior.

## 2. Target and focus

Keyboard operations bind to a verified foreground application and focused-window/control lineage. They do not depend on a screenshot's pixel revision. An app-wide documented shortcut can be valid before a content window exists, allowing windowless bootstrap. A text operation requires evidence that the intended focus destination remains current, but should not reject an application's custom editor solely because its AX role is not `AXTextField`.

Expose `focusEvidence` and coverage. When the control identity is available, retain and revalidate it. When only application/window focus and a previously grounded editor region are available, qualify that weaker route and use short chunks/checks. Secure or permission-blocked fields receive explicit treatment under D19; do not route around them through another application.

Focus loss during typing stops remaining chunks and reports the submitted prefix length where known. Do not automatically refocus and continue: the user may have intervened, and duplicated text cannot be assumed harmless.

## 3. Unicode delivery

Validate input size and encoding before dispatch. Preserve surrogate pairs and grapheme boundaries when chunking; do not split a UTF-16 pair between events. Use the platform's supported Unicode payload mechanism within a documented per-event bound, established by SDK/fixture qualification. Send chunks through the same native event queue and authority checks, not an unbounded tight loop in Electron.

Initial logical chunk target is up to 32 grapheme clusters or 128 UTF-16 units, whichever bound is reached first; actual event capacity may require smaller chunks. This is a delivery profile, not an advertised universal CGEvent limit. Verify emoji, combining marks, multiline text, CJK and right-to-left scripts in fixtures. Newline behavior may invoke UI actions; literal text and a Return key are separate choices and must not be conflated.

Large text has an explicit tradeoff. If clipboard paste is granted, the caller may select it and the human sees actual text enter the foreground UI. Otherwise use bounded text events. Never silently write a document on disk and call that typing.

## 4. Chords and held keys

Compile a chord to modifier-down, key-down/up and reverse modifier-up transitions using the same timeline ledger as pointer gestures. Logical aliases are normalized in generated contracts; invalid or duplicated contradictory keys fail before admission. Auto-repeat and timed holds have explicit durations/rates within the supported profile, rather than guessing the OS's user preference.

Native ownership tracks precisely which automation transitions were admitted. Release on completion, cancellation, checkpoint, worker loss and epoch revoke. A user-held physical modifier is not owned by automation; the driver must detect conflicting hardware state where possible and stop or ask the host rather than issuing blanket releases. No stuck-key guarantee is made until G05/G04 fault tests pass for the chosen backend.

## 5. IME and layout qualification

The capability result distinguishes text insertion, physical keys, logical shortcuts, IME composition observation and candidate selection. Test at least US, one non-US Latin layout, and a CJK IME on actual signed hosts. Report app/version/layout outcomes separately. A general text editor success does not qualify terminal, browser contenteditable and drawing text tools automatically.

Where AX exposes composition text/range, treat it as observed state with privacy filtering. Do not read marked secure text. If composition cannot be controlled reliably, expose the limitation; a caller may choose a different explicit route, not falsely report hardware-equivalent typing.

## 6. Clipboard capability and restoration

Clipboard is a global shared resource with privacy implications. Read, write and paste are separate grants. `writeText` and `writeImage` accept bounded approved MIME types; begin with plain text and explicit image artifacts, not arbitrary executable file promises. Store only the data needed for the operation and erase temporary copies at scope end.

The platform's `changeCount` can detect many intervening writes, but a read/check/write sequence is **not an atomic compare-and-swap**. Therefore default clipboard operation does not automatically restore old data. An opt-in best-effort restoration may compare change count and owned marker, but must disclose that concurrency cannot be guaranteed and must skip restoration whenever foreign change is detected. For strict noninterference, leave restoration to explicit user action instead of risking overwriting new clipboard contents.

`pasteText`/`pasteImage` verify foreground target and invokes the UI paste action/shortcut through the selected route. It never writes directly into a backing file. Read permission changes or newer pasteboard access behavior can require user approval; query actual capability and show a clear reason rather than assuming permission from an earlier OS version.

## 7. Receipts and recovery

Receipt records operation kind, selected route, target/focus identity, planned/submitted chunks or transitions, cancellation boundary and outcome evidence. Do not log literal typed/clipboard text by default. Code/source can contain sensitive text, so debugging export requires separate consent.

After an uncertain chord or partially typed string, observe before deciding whether to retry, undo or continue. An automatic Ctrl+A/retype recovery may destroy existing user content and is prohibited unless explicitly programmed within the granted task and verified target.

## 8. Implementation and tests

Replace `PublicEventBackend.typeChunk/key` PID-only routing with a `KeyboardBackend` contract and `KeyboardLayoutProfile`; keep Unicode chunking portable and testable. Integrate the current focus checks as evidence rather than the only allowed role whitelist. Add host `ClipboardCapabilityBroker` with D19 redaction/retention rules.

**KEY-01:** emoji/combining/CJK chunks are not split or duplicated. **KEY-02:** caret/selection semantics preserved. **KEY-03:** a windowless app shortcut can create a window under an app grant. **KEY-04:** focus takeover stops remaining text. **KEY-05:** cancellation releases only owned modifier state. **KEY-06:** unsupported layout/IME profile fails honestly. **KEY-07:** custom editor roles can qualify without lying about AX support. **CLIP-01:** no read/write without the corresponding grant. **CLIP-02:** foreign clipboard changes are not overwritten by default. **CLIP-03:** paste really traverses the foreground UI. **CLIP-04:** permission change and oversized/malformed formats fail safely.

`Keyboard.repeat(key,{count,intervalMs,holdMs?})` compiles explicit repeated key transitions to the same native timeline; finite count/timing bounds are admission checks. It does not borrow the user’s autorepeat preference. Image clipboard methods accept authorized `ImageEvidence`, resolve bytes through the artifact service and use the same default-off restoration policy as text.
