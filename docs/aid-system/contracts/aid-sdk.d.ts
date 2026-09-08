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
export type ApiVersion = "1.0";
export type ExecutionMode = "visible-ui" | "physical-ui" | "hybrid";
export type EffectClass = "pure" | "evidence-read" | "window-mutation" | "semantic-input" | "physical-input" | "clipboard-read" | "clipboard-write" | "artifact-export" | "supervisor";
export type Capability = "apps.read" | "apps.prepare" | "windows.read" | "windows.control" | "accessibility.read" | "accessibility.act" | "capture.read" | "pointer.control" | "keyboard.control" | "clipboard.read" | "clipboard.write" | "artifacts.read" | "artifacts.export" | "hybrid.execute";
export type ErrorCode = "UNAUTHORIZED" | "CONTROL_EXPIRED" | "RESOURCE_EXPIRED" | "RESOURCE_NOT_FOUND" | "WORKSPACE_LOST" | "WORKSPACE_BUSY" | "STALE_TARGET" | "AMBIGUOUS_TARGET" | "INCOMPLETE_EVIDENCE" | "FOCUS_CHANGED" | "USER_TAKEOVER" | "UNSUPPORTED_CAPABILITY" | "UNQUALIFIED_CAPABILITY" | "RESOURCE_LIMIT" | "CANCELLED" | "DEADLINE_EXCEEDED" | "REQUEST_CONFLICT" | "CHECKPOINT_EXPIRED" | "DELIVERY_UNCERTAIN" | "DEPENDENCY_CHANGED" | "INVALID_ARGUMENT" | "INTERNAL";
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
export type EvidenceState = "change_observed" | "no_change_observed" | "not_checked";
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
  readonly windowId: WindowId;
  readonly timing: ObservationTiming;
  readonly coverage: Coverage;
  readonly consistency: "consistent" | "changed-during-collection" | "partial";
  readonly images: readonly ImageEvidence[];
  readonly baseObservationId?: ObservationId;
  readonly changes: readonly JsonObject[];
  /** Synchronous query of this frozen evidence, not a hidden live AX request. */
  query(spec: Query): ElementSelection;
  point(xPixels: number, yPixels: number, imageIndex?: number): Point;
  bindSurface(binding: SurfaceBinding): Promise<Surface>;
  release(): Promise<void>;
}
export interface AppQuery {
  readonly bundleId?: string;
  readonly pid?: number;
  readonly name?: string;
}
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
export interface App extends Resource<"app"> {
  readonly name: string;
  readonly bundleId?: string;
  readonly pid: number;
  readonly launchIdentity: string;
  readonly keyboard: Keyboard;
  windows(): Promise<readonly Window[]>;
  mainWindow(): Promise<Window>;
  activate(options?: { readonly window?: WindowChoice }): Promise<Receipt>;
  describe(): Promise<Description>;
}
export interface Window extends Resource<"window"> {
  readonly appId: AppId;
  readonly title: string;
  readonly frame: CoordinateFrame;
  readonly keyboard: Keyboard;
  focus(): Promise<Receipt>;
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
  until<T>(predicate: () => Promise<T | null>, options: { readonly deadlineMs: number; readonly scope: Window | Surface; readonly reconcileMs?: number }): Promise<T>;
  watchQuery(window: Window, query: Query): Promise<Watch<ElementSelection>>;
  wait(ms: number): Promise<void>;
}
export interface ClipboardValue { readonly text: string; readonly changeCount: UInt64; }
export interface Clipboard {
  readText(): Promise<ClipboardValue>;
  writeText(text: string): Promise<{ readonly receipt: Receipt; readonly changeCount: UInt64 }>;
  /** Explicit UI paste; restoring is compare-and-swap and may be skipped. */
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
  inspectReceipts(): Promise<readonly Receipt[]>;
}
export interface WorkspaceContext {
  readonly id: WorkspaceId;
  modules(): Promise<readonly { readonly name: string; readonly revision: ModuleRevision }[]>;
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
    prepare(request: PrepareAppRequest): Promise<App>;
  };
  readonly windows: { get(id: WindowId): Promise<Window>; list(app?: App): Promise<readonly Window[]> };
  readonly pointer: Pointer;
  /** Bound to an explicitly established execution target; never follows user focus silently. */
  readonly keyboard: Keyboard;
  readonly observe: { window(window: Window, options?: ObserveOptions): Promise<Observation> };
  readonly events: Events;
  readonly clipboard: Clipboard;
  readonly execution: ExecutionContext;
  readonly workspace: WorkspaceContext;
  describe(moduleOrResource?: string | Resource<string>): Promise<Description>;
}
export declare const aid: Aid;

// Protocol-neutral outer host API. Authenticated owner/approval identity is
// provided out of band by the trusted host and is deliberately absent here.
export interface RequestedBudget {
  readonly wallMs?: number;
  readonly computeMs?: number;
  readonly memoryMiB?: number;
  readonly pendingCalls?: number;
}
export interface ControlRequest {
  readonly mode: ExecutionMode;
  readonly capabilities: readonly Capability[];
  readonly apps?: readonly AppQuery[];
  readonly durationMs?: number;
}
export interface OpenRequest {
  readonly idempotencyKey: string;
  readonly workspaceName: string;
  readonly control?: ControlRequest;
}
export interface OpenResult {
  readonly workspaceId: WorkspaceId;
  readonly runtimeInstanceId: RuntimeId;
  readonly control?: { readonly id: ControlId; readonly epoch: UInt64; readonly seatId: SeatId; readonly expiresAt: string };
  readonly capabilities: readonly CapabilityStatus[];
}
export type SourceInput = { readonly kind: "inline"; readonly text: string } | { readonly kind: "artifact"; readonly artifactId: ArtifactId; readonly sha256: string };
export interface ExecRequest {
  readonly workspaceId: WorkspaceId;
  readonly controlId?: ControlId;
  readonly idempotencyKey: string;
  readonly cellName: string;
  readonly source: SourceInput;
  readonly budget?: RequestedBudget;
}
export type ExecutionState = "queued" | "running" | "waiting-for-condition" | "waiting-for-model" | "waiting-for-user" | "paused" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted-after-possible-effect";
export interface Checkpoint {
  readonly id: CheckpointId;
  readonly kind: "model-decision" | "human-approval";
  readonly executionId: ExecutionId;
  readonly responseSchema: JsonSchema;
  readonly expiresAt: string;
  readonly question: string;
  readonly evidenceIds: readonly ObservationId[];
}
export interface ExecutionSnapshot {
  readonly executionId: ExecutionId;
  readonly workspaceId: WorkspaceId;
  readonly state: ExecutionState;
  readonly sequence: UInt64;
  readonly lastOperationId?: OperationId;
  readonly checkpoint?: Checkpoint;
  readonly receiptIds: readonly OperationId[];
  readonly artifactIds: readonly ArtifactId[];
  readonly historyComplete: boolean;
  readonly quiescent: boolean;
  readonly error?: { readonly code: ErrorCode; readonly message: string };
}
export type InspectRequest =
  | { readonly executionId: ExecutionId; readonly sinceSequence?: UInt64 }
  | { readonly workspaceId: WorkspaceId };
export interface RespondRequest {
  readonly executionId: ExecutionId;
  readonly checkpointId: CheckpointId;
  readonly idempotencyKey: string;
  readonly response: JsonValue;
}
export type CloseRequest =
  | { readonly executionId: ExecutionId }
  | { readonly controlId: ControlId }
  | { readonly workspaceId: WorkspaceId };
export interface CloseResult { readonly state: "stopping" | "quiescent"; readonly cleanupErrors: readonly string[]; }
export interface DescribeRequest { readonly module?: string; }
export interface HostApi {
  open(request: OpenRequest): Promise<OpenResult>;
  exec(request: ExecRequest): Promise<ExecutionSnapshot>;
  inspect(request: InspectRequest): Promise<ExecutionSnapshot | JsonObject>;
  respond(request: RespondRequest): Promise<ExecutionSnapshot>;
  close(request: CloseRequest): Promise<CloseResult>;
  describe(request: DescribeRequest): Promise<Description>;
}
