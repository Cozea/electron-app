import { create } from 'zustand'

import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewSessionState,
} from '@shared/nativePreviewTypes'

export interface NativePreviewScopeState {
  iosSimulators: NativePreviewIosSimulatorDevice[]
  selectedIosSimulatorId: string | null
  sessionState: NativePreviewSessionState | null
  simulatorsLoading: boolean
  simulatorsError: string | null
  sessionLoading: boolean
  sessionError: string | null
}

interface NativePreviewStoreState {
  scopes: Record<string, NativePreviewScopeState>
  actions: {
    ensureScope: (scopeKey: string) => void
    setIosSimulators: (scopeKey: string, devices: NativePreviewIosSimulatorDevice[]) => void
    setSelectedIosSimulatorId: (scopeKey: string, deviceId: string | null) => void
    setSessionState: (scopeKey: string, state: NativePreviewSessionState | null) => void
    setSimulatorsLoading: (scopeKey: string, loading: boolean) => void
    setSimulatorsError: (scopeKey: string, error: string | null) => void
    setSessionLoading: (scopeKey: string, loading: boolean) => void
    setSessionError: (scopeKey: string, error: string | null) => void
    reset: (scopeKey: string) => void
  }
}

export const DEFAULT_NATIVE_PREVIEW_SCOPE_STATE: NativePreviewScopeState = {
  iosSimulators: [],
  selectedIosSimulatorId: null,
  sessionState: null,
  simulatorsLoading: false,
  simulatorsError: null,
  sessionLoading: false,
  sessionError: null,
}

function choosePreferredSimulator(
  devices: NativePreviewIosSimulatorDevice[],
  currentDeviceId: string | null
): string | null {
  if (currentDeviceId && devices.some((device) => device.udid === currentDeviceId)) {
    return currentDeviceId
  }

  const bootedDevice = devices.find((device) => device.state === 'Booted')
  if (bootedDevice) {
    return bootedDevice.udid
  }

  return devices[0]?.udid ?? null
}

function getScopeState(
  scopes: Record<string, NativePreviewScopeState>,
  scopeKey: string
): NativePreviewScopeState {
  return scopes[scopeKey] ?? DEFAULT_NATIVE_PREVIEW_SCOPE_STATE
}

export const useNativePreviewStore = create<NativePreviewStoreState>()((set) => ({
  scopes: {},
  actions: {
    ensureScope: (scopeKey) => set((state) => {
      if (state.scopes[scopeKey]) {
        return state
      }

      return {
        scopes: {
          ...state.scopes,
          [scopeKey]: DEFAULT_NATIVE_PREVIEW_SCOPE_STATE,
        },
      }
    }),
    setIosSimulators: (scopeKey, devices) => set((state) => {
      const scope = getScopeState(state.scopes, scopeKey)
      return {
        scopes: {
          ...state.scopes,
          [scopeKey]: {
            ...scope,
            iosSimulators: devices,
            selectedIosSimulatorId: choosePreferredSimulator(devices, scope.selectedIosSimulatorId),
          },
        },
      }
    }),
    setSelectedIosSimulatorId: (scopeKey, deviceId) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          selectedIosSimulatorId: deviceId,
        },
      },
    })),
    setSessionState: (scopeKey, sessionState) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          sessionState,
        },
      },
    })),
    setSimulatorsLoading: (scopeKey, simulatorsLoading) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          simulatorsLoading,
        },
      },
    })),
    setSimulatorsError: (scopeKey, simulatorsError) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          simulatorsError,
        },
      },
    })),
    setSessionLoading: (scopeKey, sessionLoading) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          sessionLoading,
        },
      },
    })),
    setSessionError: (scopeKey, sessionError) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          ...getScopeState(state.scopes, scopeKey),
          sessionError,
        },
      },
    })),
    reset: (scopeKey) => set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: DEFAULT_NATIVE_PREVIEW_SCOPE_STATE,
      },
    })),
  },
}))
