// GENERATED from contract-source.json; run tools/design.py generate.
// Contract SHA256: 78d10d3812d51e15a06593ef8139c115777bad7aa526e410a4c0bc788fb309ca; generator design.py/1.1
/**
 * Cozea AID design contract, revision 1.1.
 * Declarations and test oracle only: no production implementation is supplied.
 * Named ES-module cells import `aid` from `aid:runtime`.
 * All native effects are owner/runtime/control-epoch checked outside the guest.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonSchema = JsonObject;
declare const idBrand: unique symbol;
declare const uintBrand: unique symbol;
export type Id<K extends string> = string & { readonly [idBrand]: K };
/** Decimal nonnegative integer string; constructed by a checked codec, never Number(). */
export type UInt64 = string & { readonly [uintBrand]: "uint64-decimal" };
export type RuntimeId = Id<"runtime">;
export type WorkspaceId = Id<"workspace">;
export type ControlId = Id<"control">;
export type ExecutionId = Id<"execution">;
export type OperationId = Id<"operation">;
export type CheckpointId = Id<"checkpoint">;
export type ObservationId = Id<"observation">;
export type ArtifactId = Id<"artifact">;
export type AppId = Id<"app">;
export type WindowId = Id<"window">;
export type ElementId = Id<"element">;
export type SurfaceId = Id<"surface">;
export type FrameId = Id<"frame">;
export type SeatId = Id<"seat">;
export type WatchId = Id<"watch">;
export type ModuleRevision = Id<"module-revision">;
export type ApiVersion = "1.1";
export type ExecutionMode = "visible-ui" | "physical-ui" | "hybrid";
export type EffectClass = "pure" | "evidence-read" | "window-mutation" | "semantic-input" | "physical-input" | "clipboard-read" | "clipboard-write" | "artifact-export" | "supervisor";
export type Capability = "apps.read" | "apps.prepare" | "windows.read" | "windows.control" | "accessibility.read" | "accessibility.act" | "capture.read" | "pointer.control" | "keyboard.control" | "clipboard.read" | "clipboard.write" | "artifacts.read" | "artifacts.export" | "hybrid.execute";
export type ErrorCode = "AMBIGUOUS_TARGET" | "BASE_EXPIRED" | "CANCELLED" | "CAPTURE_CAPACITY" | "CHECKPOINT_EXPIRED" | "CLEANUP_FAILED" | "CONTROL_EXPIRED" | "DEADLINE_EXCEEDED" | "DELIVERY_UNCERTAIN" | "DEPENDENCY_CHANGED" | "DRIVER_LOST" | "FOCUS_CHANGED" | "INCOMPLETE_EVIDENCE" | "INTERNAL" | "INVALID_ARGUMENT" | "NO_USABLE_WINDOW" | "PREDICATE_BUDGET" | "REQUEST_CONFLICT" | "RESOURCE_EXPIRED" | "RESOURCE_LIMIT" | "RESOURCE_NOT_FOUND" | "SEAT_BUSY" | "STALE_TARGET" | "UNAUTHORIZED" | "UNQUALIFIED_CAPABILITY" | "UNSAFE_CHECKPOINT" | "UNSUPPORTED_CAPABILITY" | "USER_TAKEOVER" | "WORKSPACE_BUSY" | "WORKSPACE_LOST";
export interface AidError extends Error {
  readonly code: ErrorCode;
  readonly phase: "validation" | "admission" | "preparation" | "presentation" | "submission" | "observation" | "checkpoint" | "cleanup" | "transport";
  readonly executionId?: ExecutionId;
  readonly operationId?: OperationId;
  readonly canRetryAutomatically: boolean;
  readonly details: JsonObject;
}
export interface CapabilityStatus {
  readonly name: string;
  readonly supported: boolean;
  readonly qualified: boolean;
  readonly granted: boolean;
  readonly currentlyAvailable: boolean;
  readonly profileId?: string;
  readonly reason?: string;
}
export interface Resource<K extends string> {
  readonly id: Id<K>;
  readonly runtimeInstanceId: RuntimeId;
  readonly generation: UInt64;
}
export interface Size { readonly width: number; readonly height: number; }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export type Vec2 = readonly [number, number];
export interface CoordinateFrame extends Resource<"frame"> {
  readonly kind: "desktop-points" | "display-points" | "window-points" | "image-pixels" | "surface-normalized";
  readonly transformGeneration: UInt64;
  readonly units: "point" | "pixel" | "normalized";
  readonly extent: Rect;
  readonly parentFrameId?: FrameId;
  readonly observationId?: ObservationId;
}
export interface Point {
  readonly kind: "framed-point";
  readonly frameId: FrameId;
  readonly transformGeneration: UInt64;
  readonly x: number;
  readonly y: number;
}
export interface SurfacePoint extends Point { readonly surfaceId: SurfaceId; }
export interface FramedRect { readonly frameId: FrameId; readonly transformGeneration: UInt64; readonly rect: Rect; }
export interface OperationBarrier { readonly operationId: OperationId; readonly sequence: UInt64; }
export type Submission = "not_submitted" | "submitted" | "submission_uncertain";
export type EvidenceState = "change_observed" | "no_change_observed" | "not_checked" | "inconclusive";
export type Outcome = "verified" | "unverified" | "failed";
export interface Receipt {
  readonly operationId: OperationId;
  readonly executionId: ExecutionId;
  readonly target?: { readonly windowId?: WindowId; readonly elementId?: ElementId; readonly surfaceId?: SurfaceId; readonly generation: UInt64 };
  readonly route: "foreground-event" | "semantic-ax" | "targeted-event" | "sky" | "window-control" | "clipboard" | "none";
  readonly submission: Submission;
  readonly evidence: EvidenceState;
  readonly outcome: Outcome;
  readonly after: OperationBarrier;
  readonly evidenceIds: readonly ObservationId[];
  readonly canRetryAutomatically: boolean;
  readonly verification?: { readonly predicate: string; readonly evidenceIds: readonly ObservationId[] };
  readonly timingsMs: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}
export interface Coverage {
  readonly complete: boolean;
  readonly reasons: readonly ("node-budget" | "depth-budget" | "time-budget" | "text-budget" | "unsupported" | "stale" | "permission" | "missing-base")[];
  readonly nodesRead: number;
  readonly continuation?: string;
}
export interface ObservationTiming {
  readonly captureMonotonicNs?: UInt64;
  readonly axStartedMonotonicNs?: UInt64;
  readonly axEndedMonotonicNs?: UInt64;
  readonly emittedMonotonicNs?: UInt64;
  readonly clockDomain: string;
  readonly clockUncertaintyMs: number;
  readonly after?: OperationBarrier;
}
export interface Artifact extends Resource<"artifact"> {
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly expiresAt: string;
  readonly dimensions?: Size;
  readonly observationId?: ObservationId;
  /** Checked owner-scoped read; not an arbitrary filesystem/URL fetch. */
  read(options?: { readonly offset?: number; readonly length?: number }): Promise<Uint8Array>;
  release(): Promise<void>;
}
export interface ImageEvidence {
  readonly artifact: Artifact;
  readonly frame: CoordinateFrame;
  readonly source: "stream" | "one-shot" | "recorded-fixture";
  readonly sourceFrameId: FrameId;
  readonly captureGeneration: UInt64;
  readonly crop?: FramedRect;
}
export interface Query {
  readonly roles?: readonly string[];
  readonly name?: string | RegExp;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly within?: ElementId;
  readonly limit?: number;
  readonly raw?: boolean;
}
export interface ElementState {
  readonly role: string;
  readonly label: string;
  readonly value?: JsonValue;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly frame?: FramedRect;
  readonly actions: readonly string[];
  readonly settable: boolean;
  readonly observationId: ObservationId;
  readonly coverage: Coverage;
}
export interface Element extends Resource<"element"> {
  readonly windowId: WindowId;
  readonly observed: ElementState;
  /** Revalidate this identity; never silently resolve a lookalike by title. */
  refresh(): Promise<ElementState>;
  children(options?: { readonly continuation?: string; readonly limit?: number; readonly raw?: boolean }): Promise<ElementSelection>;
  perform(action: string): Promise<Receipt>;
  setValue(value: string | number | boolean): Promise<Receipt>;
  describe(): Promise<Description>;
}
export interface ElementSelection {
  readonly items: readonly Element[];
  readonly coverage: Coverage;
  /** Throws on zero/multiple matches or incomplete uniqueness evidence. */
  one(): Element;
}
export interface ImageRequest {
  readonly mode: "overview" | "detail" | "overview+detail";
  readonly maxDimension?: number;
  readonly format?: "png" | "jpeg";
  readonly detailRegions?: readonly FramedRect[];
}
export interface AccessibilityRequest {
  readonly scope?: ElementId;
  readonly roles?: readonly string[];
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly textLimit?: number;
  readonly raw?: boolean;
}
export interface ObserveOptions {
  readonly accessibility?: boolean | AccessibilityRequest;
  readonly image?: false | "overview" | ImageRequest;
  readonly since?: ObservationId;
  readonly after?: OperationBarrier;
  readonly deadlineMs?: number;
}
export interface SurfaceBinding {
  readonly region: FramedRect;
  readonly anchors?: readonly ElementId[];
  readonly intent: "drawing" | "dragging" | "generic-spatial";
  readonly maxAgeMs?: number;
  readonly maxActions?: number;
  readonly requiredCoverage?: "qualified" | "bounded-uncertainty";
}
export interface Observation extends Resource<"observation"> {
  /** Absent for an explicitly authorized desktop/multidisplay observation. */
  readonly windowId?: WindowId;
  readonly timing: ObservationTiming;
  readonly coverage: Coverage;
  readonly consistency: "consistent" | "changed-during-collection" | "partial";
  readonly images: readonly ImageEvidence[];
  readonly baseObservationId?: ObservationId;
  readonly changes: readonly JsonObject[];
  /** Synchronous query of this frozen evidence, not a hidden live AX request. */
  query(spec: Query): ElementSelection;
  point(xPixels: number, yPixels: number, imageIndex?: number): Point;
  crop(region: FramedRect, options?: { readonly maxDimension?: number }): Promise<ImageEvidence>;
  diff(base: Observation): Promise<Observation>;
  bindSurface(binding: SurfaceBinding): Promise<Surface>;
  release(): Promise<void>;
}
export type AppQuery =
  | { readonly bundleId: string; readonly name?: never; readonly pid?: never; readonly launchIdentity?: never }
  | { readonly name: string; readonly bundleId?: never; readonly pid?: never; readonly launchIdentity?: never }
  | { readonly pid: number; readonly launchIdentity: string; readonly bundleId?: never; readonly name?: never };
export interface AppListing {
  readonly name: string;
  readonly bundleId?: string;
  readonly pid?: number;
  readonly running: boolean;
  readonly eligible: boolean;
}
export interface WindowChoice {
  readonly id?: WindowId;
  readonly title?: string;
  readonly role?: string;
}
export interface PrepareAppRequest {
  readonly app: AppQuery;
  readonly launch?: boolean;
  readonly unhide?: boolean;
  readonly reopen?: boolean;
  readonly foreground?: boolean;
  readonly window?: WindowChoice;
}
export interface PreparedApp { readonly app: App; readonly window?: Window; readonly receipt: Receipt; }
export interface App extends Resource<"app"> {
  readonly name: string;
  readonly bundleId?: string;
  readonly pid: number;
  readonly launchIdentity: string;
  readonly keyboard: Keyboard;
  windows(): Promise<readonly Window[]>;
  mainWindow(): Promise<Window>;
  menu(query?: Query): Promise<ElementSelection>;
  activate(options?: { readonly window?: WindowChoice }): Promise<Receipt>;
  describe(): Promise<Description>;
}
export interface Window extends Resource<"window"> {
  readonly appId: AppId;
  readonly title: string;
  readonly frame: CoordinateFrame;
  readonly keyboard: Keyboard;
  focus(): Promise<Receipt>;
  refresh(): Promise<Window>;
  setBounds(bounds: FramedRect): Promise<Receipt>;
  observe(options?: ObserveOptions): Promise<Observation>;
  /** Explicit live scoped query. */
  query(spec: Query): Promise<ElementSelection>;
  point(xPoints: number, yPoints: number): Point;
  describe(): Promise<Description>;
}
export interface Surface extends Resource<"surface"> {
  readonly windowId: WindowId;
  readonly frame: CoordinateFrame;
  readonly intent: SurfaceBinding["intent"];
  readonly coverage: "qualified" | "bounded-uncertainty";
  readonly pointer: SurfacePointer;
  point(u: number, v: number): SurfacePoint;
  validate(): Promise<{ readonly valid: boolean; readonly reasons: readonly string[] }>;
  observe(options?: ObserveOptions): Promise<Observation>;
  release(): Promise<void>;
}
export type MouseButton = "left" | "right" | "middle";
export type CursorPacing = "fast-visible" | "presentation";
export interface MoveOptions { readonly durationMs?: number; readonly pacing?: CursorPacing; }
export interface ClickOptions {
  readonly button?: MouseButton;
  readonly count?: 1 | 2;
  readonly route?: "auto" | "physical" | "semantic";
  readonly pacing?: CursorPacing;
}
export interface PathOptions {
  readonly durationMs: number;
  readonly interpolation: "polyline" | "cubic";
  readonly maxLatenessMs?: number;
  readonly overload?: "abort" | "slow-within-tolerance";
}
export interface StrokeOptions extends PathOptions { readonly button?: MouseButton; readonly approach?: CursorPacing; }
export interface ScrollOptions {
  readonly dx: number;
  readonly dy: number;
  readonly units: "pixel" | "line";
  readonly phase?: "began" | "changed" | "ended";
  readonly durationMs?: number;
}
export interface Pointer {
  moveTo(target: Point, options?: MoveOptions): Promise<Receipt>;
  moveBy(delta: { readonly frameId: FrameId; readonly dx: number; readonly dy: number }, options?: MoveOptions): Promise<Receipt>;
  hover(target: Element | Point, options?: { readonly dwellMs?: number; readonly pacing?: CursorPacing }): Promise<Receipt>;
  click(target: Element | Point, options?: ClickOptions): Promise<Receipt>;
  buttonDown(button: MouseButton): Promise<Receipt>;
  buttonUp(button: MouseButton): Promise<Receipt>;
  withButtonDown<T>(button: MouseButton, body: () => Promise<T>): Promise<T>;
  followPath(points: readonly Point[], options: PathOptions): Promise<Receipt>;
  scroll(target: Element | Point, options: ScrollOptions): Promise<Receipt>;
  play(timeline: Timeline): Promise<Receipt>;
}
export interface SurfacePointer {
  /** Bare pairs here are normalized coordinates of this bound surface only. */
  stroke(points: readonly (Vec2 | SurfacePoint)[], options: StrokeOptions): Promise<Receipt>;
  moveTo(point: Vec2 | SurfacePoint, options?: MoveOptions): Promise<Receipt>;
  click(point: Vec2 | SurfacePoint, options?: ClickOptions): Promise<Receipt>;
}
export type Modifier = "shift" | "control" | "alt" | "super";
export interface PhysicalKey { readonly kind: "physical"; readonly code: number; }
export interface LogicalKey { readonly kind: "logical"; readonly key: string; }
export type Key = PhysicalKey | LogicalKey;
export interface Keyboard {
  typeText(text: string, options?: { readonly deadlineMs?: number }): Promise<Receipt>;
  chord(keys: string | readonly Key[], options?: { readonly holdMs?: number }): Promise<Receipt>;
  keyDown(key: Key): Promise<Receipt>;
  keyUp(key: Key): Promise<Receipt>;
  repeat(key: Key, options: { readonly count: number; readonly intervalMs: number; readonly holdMs?: number }): Promise<Receipt>;
  withKeysDown<T>(keys: readonly Key[], body: () => Promise<T>): Promise<T>;
}
export type NativeCondition =
  | { readonly kind: "focused-window"; readonly windowId: WindowId }
  | { readonly kind: "element-enabled"; readonly elementId: ElementId }
  | { readonly kind: "frame-after"; readonly windowId: WindowId; readonly after: OperationBarrier };
export type TimelineEvent =
  | { readonly atMs: number; readonly kind: "pointer-position"; readonly point: Point }
  | { readonly atMs: number; readonly kind: "button-down" | "button-up"; readonly button: MouseButton }
  | { readonly atMs: number; readonly kind: "key-down" | "key-up"; readonly key: Key }
  | { readonly atMs: number; readonly kind: "scroll"; readonly options: ScrollOptions }
  | { readonly atMs: number; readonly kind: "condition"; readonly condition: NativeCondition; readonly timeoutMs: number };
export interface Timeline {
  readonly events: readonly TimelineEvent[];
  readonly durationMs: number;
  readonly maxLatenessMs: number;
  readonly overload: "abort" | "slow-within-tolerance";
}
export interface Watch<T> extends Resource<"watch"> {
  next(options?: { readonly deadlineMs?: number }): Promise<T>;
  close(): Promise<void>;
}
export interface Events {
  /** Predicate executes in a host-established read-only guest scope. */
  until<T>(predicate: () => Promise<T | null>, options: { readonly deadlineMs: number; readonly scope: Window | Surface; readonly reconcileMs?: number; readonly stableForMs?: number }): Promise<T>;
  watchQuery(window: Window, query: Query): Promise<Watch<ElementSelection>>;
  wait(ms: number): Promise<void>;
}
export interface ClipboardValue { readonly text: string; readonly changeCount: UInt64; }
export interface Clipboard {
  readText(): Promise<ClipboardValue>;
  writeText(text: string): Promise<{ readonly receipt: Receipt; readonly changeCount: UInt64 }>;
  writeImage(image: ImageEvidence): Promise<{ readonly receipt: Receipt; readonly changeCount: UInt64 }>;
  pasteImage(target: App | Window, image: ImageEvidence, options?: { readonly restore?: boolean }): Promise<Receipt>;
  /** Explicit UI paste. Restore defaults false; opt-in restoration is best effort, never atomic CAS. Skip when changeCount differs; races remain possible. */
  pasteText(target: App | Window, text: string, options?: { readonly restore?: boolean }): Promise<Receipt>;
}
export type Emission =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly image: ImageEvidence }
  | { readonly kind: "observation"; readonly observation: Observation }
  | { readonly kind: "json"; readonly value: JsonValue };
export interface DecisionRequest {
  readonly question: string;
  readonly observation?: Observation;
  readonly choices?: readonly JsonObject[];
  readonly responseSchema: JsonSchema;
  readonly deadlineMs?: number;
}
export interface ExecutionContext {
  readonly id: ExecutionId;
  emit(value: Emission): Promise<void>;
  /** Same-model typed decision; cannot satisfy a human approval request. */
  decide<T extends JsonValue = JsonValue>(request: DecisionRequest): Promise<T>;
  /** A request to the trusted human-approval surface; the answer is not a grant. */
  requestApproval(request: DecisionRequest): Promise<{ readonly approved: boolean }>;
  inspectReceipts(): Promise<readonly Receipt[]>;
}
export interface WorkspaceContext {
  readonly id: WorkspaceId;
  modules(): Promise<readonly { readonly name: string; readonly revision: ModuleRevision }[]>;
  /** Save an already admitted pure module revision, with explicit retention consent. */
  saveModule(name: string, revision: ModuleRevision): Promise<void>;
  saveData(name: string, value: JsonValue): Promise<void>;
  loadData(name: string): Promise<JsonValue | null>;
}
export interface Description {
  readonly apiVersion: ApiVersion;
  readonly contractHash: string;
  readonly module: string;
  readonly documentation: string;
  readonly capabilities: readonly CapabilityStatus[];
}
export interface Aid {
  readonly apps: {
    list(options?: { readonly includeInstalled?: boolean }): Promise<readonly AppListing[]>;
    /** Read-only lookup. Use prepare for launch/unhide/foreground effects. */
    get(query: AppQuery): Promise<App>;
    prepare(request: PrepareAppRequest): Promise<PreparedApp>;
  };
  readonly windows: { get(id: WindowId): Promise<Window>; list(app?: App): Promise<readonly Window[]>; focused(): Promise<Window | null> };
  readonly pointer: Pointer;
  /** Bound to an explicitly established execution target; never follows user focus silently. */
  readonly keyboard: Keyboard;
  readonly observe: { window(window: Window, options?: ObserveOptions): Promise<Observation>; surface(surface: Surface, options?: ObserveOptions): Promise<Observation>; desktop(options?: ObserveOptions): Promise<Observation>; region(region: FramedRect, options?: ObserveOptions): Promise<Observation> };
  readonly events: Events;
  readonly clipboard: Clipboard;
  readonly execution: ExecutionContext;
  readonly workspace: WorkspaceContext;
  describe(moduleOrResource?: string | Resource<string>): Promise<Description>;
}
export declare const aid: Aid;


// Generated wire values. Refinements (bounds, oneOf exclusivity, quiescence,
// evidence alignment) additionally require the JSON/semantic validator.
export type WireId = string;
export type WireKey = string;
export type WireCounter = string;
export type WireRevision = "1.1";
export type WireHash = string;
export type WireName = string;
export type WireMode = "visible-ui" | "physical-ui" | "hybrid";
export type WireJson = (null) | (boolean) | (number) | (string) | (ReadonlyArray<WireJson>) | ({ readonly [key: string]: WireJson; });
export type WireApp = ({ readonly "bundleId": string; }) | ({ readonly "name": string; }) | ({ readonly "pid": number; readonly "launchIdentity": string; });
export type WireControlRequest = { readonly "mode": WireMode; readonly "targetApps": ReadonlyArray<WireApp>; readonly "capabilities": ReadonlyArray<"apps.read" | "apps.prepare" | "windows.read" | "windows.control" | "accessibility.read" | "accessibility.act" | "capture.read" | "pointer.control" | "keyboard.control" | "clipboard.read" | "clipboard.write" | "artifacts.read" | "artifacts.export" | "hybrid.execute">; readonly "requestedLeaseMs"?: number; readonly "captureScope"?: "target-windows" | "desktop"; };
export type WireBudget = { readonly "wallMs"?: number; readonly "memoryMiB"?: number; readonly "pendingCalls"?: number; readonly "computeMs"?: number; };
export type WireSource = ({ readonly "kind": "text"; readonly "text": string; }) | ({ readonly "kind": "artifact"; readonly "artifactId": WireId; readonly "sha256": WireHash; });
export type WireCloseTarget = ({ readonly "kind": "execution"; readonly "executionId": WireId; }) | ({ readonly "kind": "control"; readonly "controlId": WireId; }) | ({ readonly "kind": "workspace"; readonly "workspaceId": WireId; });
export type WireOpen = { readonly "method": "open"; readonly "params": { readonly "apiRevision": WireRevision; readonly "idempotencyKey": WireKey; readonly "workspaceName": WireName; readonly "reuse"?: boolean; readonly "control"?: WireControlRequest; }; };
export type WireExec = { readonly "method": "exec"; readonly "params": { readonly "apiRevision": WireRevision; readonly "workspaceId": WireId; readonly "controlId"?: WireId; readonly "idempotencyKey": WireKey; readonly "cellName": WireName; readonly "source": WireSource; readonly "requestedBudget"?: WireBudget; }; };
export type WireInspect = { readonly "method": "inspect"; readonly "params": { readonly "apiRevision": WireRevision; readonly "workspaceId": WireId; readonly "executionId"?: WireId; readonly "sinceSequence"?: WireCounter; readonly "limit"?: number; }; };
export type WireRespond = { readonly "method": "respond"; readonly "params": { readonly "apiRevision": WireRevision; readonly "workspaceId": WireId; readonly "executionId": WireId; readonly "checkpointId": WireId; readonly "idempotencyKey": WireKey; readonly "answer": WireJson; }; };
export type WireDescribe = { readonly "method": "describe"; readonly "params": { readonly "apiRevision": WireRevision; readonly "subject": string; readonly "workspaceId"?: WireId; }; };
export type WireClose = { readonly "method": "close"; readonly "params": { readonly "apiRevision": WireRevision; readonly "target": WireCloseTarget; }; };
export type WireRect = { readonly "x": number; readonly "y": number; readonly "width": number; readonly "height": number; };
export type WirePoint = { readonly "kind": "point"; readonly "frameId": WireId; readonly "transformGeneration": WireCounter; readonly "units": "normalized" | "image-pixels" | "window-points" | "display-points" | "desktop-points"; readonly "x": number; readonly "y": number; };
export type WireFrame = { readonly "id": WireId; readonly "generation": WireCounter; readonly "parentId"?: WireId; readonly "units": "normalized" | "image-pixels" | "window-points" | "display-points" | "desktop-points"; readonly "bounds": WireRect; readonly "toParent": ReadonlyArray<number>; };
export type WireFailure = { readonly "code": "AMBIGUOUS_TARGET" | "BASE_EXPIRED" | "CANCELLED" | "CAPTURE_CAPACITY" | "CHECKPOINT_EXPIRED" | "CLEANUP_FAILED" | "CONTROL_EXPIRED" | "DEADLINE_EXCEEDED" | "DELIVERY_UNCERTAIN" | "DEPENDENCY_CHANGED" | "DRIVER_LOST" | "FOCUS_CHANGED" | "INCOMPLETE_EVIDENCE" | "INTERNAL" | "INVALID_ARGUMENT" | "NO_USABLE_WINDOW" | "PREDICATE_BUDGET" | "REQUEST_CONFLICT" | "RESOURCE_EXPIRED" | "RESOURCE_LIMIT" | "RESOURCE_NOT_FOUND" | "SEAT_BUSY" | "STALE_TARGET" | "UNAUTHORIZED" | "UNQUALIFIED_CAPABILITY" | "UNSAFE_CHECKPOINT" | "UNSUPPORTED_CAPABILITY" | "USER_TAKEOVER" | "WORKSPACE_BUSY" | "WORKSPACE_LOST"; readonly "message": string; readonly "phase": "admission" | "validation" | "approach" | "dispatch" | "observation" | "checkpoint" | "cleanup" | "transport" | "guest"; readonly "executionId"?: WireId; readonly "operationId"?: WireId; readonly "submission": "not_submitted" | "submitted" | "submission_uncertain"; readonly "canRetryAutomatically": boolean; readonly "details"?: WireJson; };
export type WireReceipt = { readonly "operationId": WireId; readonly "executionId": WireId; readonly "sequence": WireCounter; readonly "phase": "admission" | "validation" | "approach" | "dispatch" | "observation" | "checkpoint" | "cleanup" | "transport" | "guest"; readonly "route": "foreground-event" | "semantic-ax" | "targeted-event" | "sky" | "window-control" | "clipboard" | "none"; readonly "submission": "not_submitted" | "submitted" | "submission_uncertain"; readonly "evidence": "not_checked" | "change_observed" | "no_change_observed" | "inconclusive"; readonly "outcome": "unverified" | "verified" | "failed"; readonly "canRetryAutomatically": boolean; readonly "target"?: { readonly "appId"?: WireId; readonly "windowId"?: WireId; readonly "elementId"?: WireId; readonly "surfaceId"?: WireId; readonly "generation": WireCounter; }; readonly "after": WireBarrier; readonly "evidenceIds": ReadonlyArray<WireId>; readonly "verification"?: { readonly "predicate": string; readonly "evidenceIds": ReadonlyArray<WireId>; }; readonly "failure"?: WireFailure; readonly "timingsMs": { readonly [key: string]: number; }; readonly "warnings": ReadonlyArray<string>; };
export type WireCheckpoint = { readonly "id": WireId; readonly "kind": "model-decision" | "human-approval"; readonly "executionId": WireId; readonly "question": string; readonly "schema": { readonly [key: string]: JsonValue; }; readonly "evidenceIds": ReadonlyArray<WireId>; readonly "dependencyDigest": string; readonly "expiresAtMs": number; };
export type WireNativeRequest = { readonly "apiRevision": "1.1"; readonly "requestId": WireId; readonly "runtimeGeneration": WireId; readonly "controlId": WireId; readonly "controlEpoch": WireCounter; readonly "executionId": WireId; readonly "operationId": WireId; readonly "method": string; readonly "arguments": { readonly [key: string]: JsonValue; }; };
export type WireBarrier = { readonly "operationId": WireId; readonly "sequence": WireCounter; };
export type WireArtifact = { readonly "kind": "artifact"; readonly "id": WireId; readonly "runtimeGeneration": WireId; readonly "mimeType": string; readonly "byteLength": number; readonly "sha256": string; readonly "expiresAtMs": number; readonly "pixelWidth"?: number; readonly "pixelHeight"?: number; readonly "observationId"?: WireId; };
export type WireImageArtifact = { readonly "kind": "artifact"; readonly "id": WireId; readonly "runtimeGeneration": WireId; readonly "mimeType": "image/png" | "image/jpeg"; readonly "byteLength": number; readonly "sha256": string; readonly "expiresAtMs": number; readonly "pixelWidth": number; readonly "pixelHeight": number; readonly "observationId": WireId; };
export type WireFramedRect = { readonly "frameId": WireId; readonly "transformGeneration": WireCounter; readonly "rect": WireRect; };
export type WireCoverage = { readonly "complete": boolean; readonly "reasons": ReadonlyArray<"node-budget" | "depth-budget" | "time-budget" | "text-budget" | "unsupported" | "stale" | "permission" | "missing-base">; readonly "nodesRead": number; readonly "continuation"?: string; };
export type WireObservationTiming = { readonly "captureMonotonicNs"?: WireCounter; readonly "axStartedMonotonicNs"?: WireCounter; readonly "axEndedMonotonicNs"?: WireCounter; readonly "emittedMonotonicNs"?: WireCounter; readonly "clockDomain": string; readonly "clockUncertaintyMs": number; readonly "after"?: WireBarrier; };
export type WireImageEvidence = { readonly "artifact": WireImageArtifact; readonly "frameId": WireId; readonly "source": "stream" | "one-shot" | "recorded-fixture"; readonly "sourceFrameId": WireId; readonly "captureGeneration": WireCounter; readonly "crop"?: WireFramedRect; };
export type WireElementEvidence = { readonly "id": WireId; readonly "windowId": WireId; readonly "parentId"?: WireId; readonly "role": string; readonly "label": string; readonly "value"?: WireJson; readonly "enabled"?: boolean; readonly "selected"?: boolean; readonly "focused"?: boolean; readonly "frame"?: WireFramedRect; readonly "actions": ReadonlyArray<string>; readonly "settable": boolean; readonly "coverage": WireCoverage; readonly "provenance": "accessibility" | "pixels" | "model-annotation"; };
export type WireObservation = { readonly "kind": "observation"; readonly "id": WireId; readonly "runtimeInstanceId": WireId; readonly "generation": WireCounter; readonly "windowId"?: WireId; readonly "timing": WireObservationTiming; readonly "coverage": WireCoverage; readonly "consistency": "consistent" | "changed-during-collection" | "partial"; readonly "frames": ReadonlyArray<WireFrame>; readonly "images": ReadonlyArray<WireImageEvidence>; readonly "elements": ReadonlyArray<WireElementEvidence>; readonly "baseObservationId"?: WireId; readonly "changes": ReadonlyArray<WireJson>; };
export type WireEmission = ({ readonly "kind": "text"; readonly "text": string; }) | ({ readonly "kind": "data"; readonly "value": WireJson; }) | ({ readonly "kind": "image"; readonly "artifact": WireImageArtifact; }) | ({ readonly "kind": "observation"; readonly "observation": WireObservation; });
export type WireCapability = { readonly "name": string; readonly "supported": boolean; readonly "qualified": boolean; readonly "granted": boolean; readonly "currentlyAvailable": boolean; readonly "reason"?: string; readonly "limits"?: WireJson; readonly "qualificationProfile"?: string; };
export type WireDescription = { readonly "apiRevision": "1.1"; readonly "contractHash": string; readonly "subject": string; readonly "capabilities": ReadonlyArray<WireCapability>; readonly "types": string; readonly "examples": ReadonlyArray<string>; readonly "limitations": ReadonlyArray<string>; };
export type WireExecutionStatus = { readonly "executionId": WireId; readonly "workspaceId": WireId; readonly "state": "queued" | "running" | "waiting-for-condition" | "waiting-for-model" | "waiting-for-user" | "paused" | "stopping" | "completed" | "failed" | "cancelled" | "lost" | "interrupted-after-possible-effect"; readonly "sequence": WireCounter; readonly "checkpoint"?: WireCheckpoint; readonly "lastReceipt"?: WireReceipt; readonly "failure"?: WireFailure; readonly "historyExpired": boolean; readonly "droppedRecords": number; readonly "quiescent": boolean; };
export type WireControlStatus = { readonly "controlId": WireId; readonly "epoch": WireCounter; readonly "state": "pending" | "active" | "revoking" | "quiescent" | "expired" | "closed"; readonly "mode": "visible-ui" | "physical-ui" | "hybrid"; readonly "quiescent": boolean; };
export type WireOpened = { readonly "kind": "opened"; readonly "workspaceId": WireId; readonly "control"?: WireControlStatus; readonly "apiRevision": "1.1"; readonly "contractHash": string; };
export type WireExecution = { readonly "kind": "execution"; readonly "status": WireExecutionStatus; readonly "emissions": ReadonlyArray<WireEmission>; };
export type WireInspection = { readonly "kind": "inspection"; readonly "executions": ReadonlyArray<WireExecutionStatus>; readonly "modules": ReadonlyArray<{ readonly "name": string; readonly "revision": string; }>; };
export type WireClosing = { readonly "kind": "closing"; readonly "target": WireCloseTarget; readonly "quiescent": boolean; };
export type WireDescribed = { readonly "kind": "description"; readonly "description": WireDescription; };
export type WireError = { readonly "kind": "error"; readonly "failure": WireFailure; };
export type HostRequest = (WireOpen) | (WireExec) | (WireInspect) | (WireRespond) | (WireClose) | (WireDescribe);
export type HostResult = (WireOpened) | (WireExecution) | (WireInspection) | (WireClosing) | (WireDescribed) | (WireError);
export interface HostApi {
  open(params: WireOpen["params"]): Promise<WireOpened | WireError>;
  exec(params: WireExec["params"]): Promise<WireExecution | WireError>;
  inspect(params: WireInspect["params"]): Promise<WireInspection | WireError>;
  respond(params: WireRespond["params"]): Promise<WireExecution | WireError>;
  close(params: WireClose["params"]): Promise<WireClosing | WireError>;
  describe(params: WireDescribe["params"]): Promise<WireDescribed | WireError>;
}
