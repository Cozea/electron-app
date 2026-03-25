import type {
  RadonFeatureAvailabilityStatus,
  RadonFeatureName,
} from '../../../shared/electronApiTypes'

interface DecodedRadonTokenPayload {
  cp_plan?: string
  cp_features?: Record<string, unknown>
}

export const DEFAULT_RADON_FEATURES: Record<RadonFeatureName, RadonFeatureAvailabilityStatus> = {
  AndroidSmartphoneEmulators: 'AVAILABLE',
  AndroidTabletEmulators: 'PAYWALLED',
  AndroidPhysicalDevice: 'PAYWALLED',
  Biometrics: 'PAYWALLED',
  ComponentPreview: 'AVAILABLE',
  DeviceAppearanceSettings: 'AVAILABLE',
  DeviceFontSizeSettings: 'AVAILABLE',
  DeviceLocalizationSettings: 'PAYWALLED',
  DeviceRotation: 'PAYWALLED',
  ElementInspector: 'AVAILABLE',
  ExpoRouterIntegration: 'AVAILABLE',
  IOSSmartphoneSimulators: 'AVAILABLE',
  IOSTabletSimulators: 'PAYWALLED',
  JSProfiler: 'AVAILABLE',
  LocationSimulation: 'PAYWALLED',
  NetworkInspection: 'AVAILABLE',
  MaestroTesting: 'PAYWALLED',
  OpenDeepLink: 'AVAILABLE',
  OutlineRenders: 'AVAILABLE',
  Permissions: 'PAYWALLED',
  ReactProfiler: 'AVAILABLE',
  ReactQueryDevTools: 'AVAILABLE',
  RadonConnect: 'AVAILABLE',
  RadonAI: 'PAYWALLED',
  ReduxDevTools: 'AVAILABLE',
  ScreenRecording: 'PAYWALLED',
  ScreenReplay: 'PAYWALLED',
  Screenshot: 'PAYWALLED',
  SendFile: 'PAYWALLED',
  StorybookIntegration: 'PAYWALLED',
}

const RADON_FEATURE_NAMES = Object.keys(DEFAULT_RADON_FEATURES) as RadonFeatureName[]
const VALID_FEATURE_STATUSES = new Set<RadonFeatureAvailabilityStatus>([
  'AVAILABLE',
  'PAYWALLED',
  'ADMIN_DISABLED',
])

export function decodeRadonTokenPayload(token: string): DecodedRadonTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) {
      return null
    }

    const payloadBase64Url = parts[1]
    const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = payloadBase64 + '==='.slice((payloadBase64.length + 3) % 4)
    const parsed = JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf8')) as Record<string, unknown>
    return parsed as DecodedRadonTokenPayload
  } catch {
    return null
  }
}

export function resolveRadonFeatures(token: string): {
  plan?: string
  features: Record<RadonFeatureName, RadonFeatureAvailabilityStatus>
  missingFeatures: RadonFeatureName[]
} {
  const payload = decodeRadonTokenPayload(token)
  const features: Record<RadonFeatureName, RadonFeatureAvailabilityStatus> = {
    ...DEFAULT_RADON_FEATURES,
  }

  for (const [key, value] of Object.entries(payload?.cp_features ?? {})) {
    if (!RADON_FEATURE_NAMES.includes(key as RadonFeatureName)) {
      continue
    }
    if (!VALID_FEATURE_STATUSES.has(value as RadonFeatureAvailabilityStatus)) {
      continue
    }
    features[key as RadonFeatureName] = value as RadonFeatureAvailabilityStatus
  }

  return {
    plan: payload?.cp_plan,
    features,
    missingFeatures: RADON_FEATURE_NAMES.filter((feature) => features[feature] !== 'AVAILABLE'),
  }
}

export function isRadonFeatureAvailable(
  features: Partial<Record<RadonFeatureName, RadonFeatureAvailabilityStatus>> | undefined,
  feature: RadonFeatureName,
): boolean {
  const status = features?.[feature] ?? DEFAULT_RADON_FEATURES[feature]
  return status === 'AVAILABLE'
}
