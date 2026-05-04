import type {
  TerminalActivityEvent,
  TerminalActivityTrackingMode,
  TerminalCreateOptions,
  TerminalExitEvent,
  TerminalInfo,
  TerminalOutputEvent,
  TerminalProfile,
  TerminalSnapshot,
} from '../../shared/electronApiTypes'

export type WorkbenchRuntimeMethod =
  | 'terminal.create'
  | 'terminal.attachView'
  | 'terminal.detachView'
  | 'terminal.input'
  | 'terminal.resize'
  | 'terminal.kill'
  | 'terminal.getProfiles'
  | 'terminal.list'
  | 'terminal.getInfo'
  | 'terminal.getSnapshot'
  | 'terminal.setActivityTracking'
  | 'terminal.killAll'

export interface WorkbenchRuntimeRequest {
  type: 'request'
  id: number
  method: WorkbenchRuntimeMethod
  params: unknown
}

export interface WorkbenchRuntimeSuccessResponse {
  type: 'response'
  id: number
  ok: true
  result: unknown
}

export interface WorkbenchRuntimeErrorResponse {
  type: 'response'
  id: number
  ok: false
  error: string
}

export type WorkbenchRuntimeResponse = WorkbenchRuntimeSuccessResponse | WorkbenchRuntimeErrorResponse

export type WorkbenchRuntimeEventName = 'terminal.output' | 'terminal.exit' | 'terminal.activity'
  | 'terminal.provenance'

export interface WorkbenchRuntimeTerminalCreateResult {
  success: boolean
  terminalId?: string
  error?: string
  snapshot?: TerminalSnapshot
  info?: TerminalInfo
}

export interface WorkbenchRuntimeTerminalExitPayload extends TerminalExitEvent {
  snapshot?: TerminalSnapshot | null
  info?: TerminalInfo | null
}

export interface WorkbenchRuntimeTerminalOutputPayload extends TerminalOutputEvent {}

export interface WorkbenchRuntimeTerminalActivityPayload extends TerminalActivityEvent {}

export interface WorkbenchRuntimeTerminalProvenancePayload {
  terminalId: string
  workspaceId: string
  gitCwd: string
  title: string
  terminalKind: string
  sessionKey?: string
  laneId?: string
  workspaceId?: string
  runId?: string
  commandId?: string
  commandText?: string
  timestamp: number
}

export interface WorkbenchRuntimeEventMessage {
  type: 'event'
  event: WorkbenchRuntimeEventName
  payload:
    | WorkbenchRuntimeTerminalOutputPayload
    | WorkbenchRuntimeTerminalExitPayload
    | WorkbenchRuntimeTerminalActivityPayload
    | WorkbenchRuntimeTerminalProvenancePayload
}

export interface WorkbenchRuntimeTerminalInputParams {
  terminalId: string
  data: string
}

export interface WorkbenchRuntimeTerminalAttachViewParams {
  terminalId: string
  cols: number
  rows: number
}

export interface WorkbenchRuntimeTerminalDetachViewParams {
  terminalId: string
}

export interface WorkbenchRuntimeTerminalResizeParams {
  terminalId: string
  cols: number
  rows: number
}

export interface WorkbenchRuntimeTerminalKillParams {
  terminalId: string
}

export interface WorkbenchRuntimeTerminalListParams {
  workspaceId: string
}

export interface WorkbenchRuntimeTerminalInfoParams {
  terminalId: string
}

export interface WorkbenchRuntimeTerminalSnapshotParams {
  terminalId: string
}

export interface WorkbenchRuntimeTerminalSetActivityTrackingParams {
  terminalId: string
  mode?: TerminalActivityTrackingMode | null
}

export interface WorkbenchRuntimeTerminalCreateParams extends TerminalCreateOptions {}

export interface WorkbenchRuntimeMethodResultMap {
  'terminal.create': WorkbenchRuntimeTerminalCreateResult
  'terminal.attachView': { success: boolean }
  'terminal.detachView': { success: boolean }
  'terminal.input': boolean
  'terminal.resize': { success: boolean }
  'terminal.kill': { success: boolean }
  'terminal.getProfiles': TerminalProfile[]
  'terminal.list': string[]
  'terminal.getInfo': TerminalInfo | null
  'terminal.getSnapshot': TerminalSnapshot | null
  'terminal.setActivityTracking': { success: boolean }
  'terminal.killAll': { success: boolean }
}
