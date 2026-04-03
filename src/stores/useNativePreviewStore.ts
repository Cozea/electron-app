import { create } from 'zustand'

import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewSessionState,
} from '@shared/nativePreviewTypes'

interface NativePreviewStoreState {
  iosSimulators: NativePreviewIosSimulatorDevice[]
  selectedIosSimulatorId: string | null
  sessionState: NativePreviewSessionState | null
  simulatorsLoading: boolean
  simulatorsError: string | null
  sessionLoading: boolean
  sessionError: string | null
  actions: {
    setIosSimulators: (devices: NativePreviewIosSimulatorDevice[]) => void
    setSelectedIosSimulatorId: (deviceId: string | null) => void
    setSessionState: (state: NativePreviewSessionState | null) => void
    setSimulatorsLoading: (loading: boolean) => void
    setSimulatorsError: (error: string | null) => void
    setSessionLoading: (loading: boolean) => void
    setSessionError: (error: string | null) => void
    reset: () => void
  }
}

const DEFAULT_STATE = {
  iosSimulators: [] as NativePreviewIosSimulatorDevice[],
  selectedIosSimulatorId: null,
  sessionState: null as NativePreviewSessionState | null,
  simulatorsLoading: false,
  simulatorsError: null as string | null,
  sessionLoading: false,
  sessionError: null as string | null,
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

export const useNativePreviewStore = create<NativePreviewStoreState>()((set) => ({
  ...DEFAULT_STATE,
  actions: {
    setIosSimulators: (devices) => set((state) => ({
      iosSimulators: devices,
      selectedIosSimulatorId: choosePreferredSimulator(devices, state.selectedIosSimulatorId),
    })),
    setSelectedIosSimulatorId: (deviceId) => set({ selectedIosSimulatorId: deviceId }),
    setSessionState: (sessionState) => set({ sessionState }),
    setSimulatorsLoading: (simulatorsLoading) => set({ simulatorsLoading }),
    setSimulatorsError: (simulatorsError) => set({ simulatorsError }),
    setSessionLoading: (sessionLoading) => set({ sessionLoading }),
    setSessionError: (sessionError) => set({ sessionError }),
    reset: () => set(DEFAULT_STATE),
  },
}))
