import { RadonRuntimeBridgeServer } from '../radon/runtimeBridge'

export class NativePreviewRuntimeBridgeService {
  private static instance: NativePreviewRuntimeBridgeService | null = null

  public static getInstance(): NativePreviewRuntimeBridgeService {
    if (!NativePreviewRuntimeBridgeService.instance) {
      NativePreviewRuntimeBridgeService.instance = new NativePreviewRuntimeBridgeService()
    }
    return NativePreviewRuntimeBridgeService.instance
  }

  private readonly bridgePromises = new Map<string, Promise<RadonRuntimeBridgeServer>>()

  public async getBridge(projectPath: string): Promise<RadonRuntimeBridgeServer> {
    const existing = this.bridgePromises.get(projectPath)
    if (existing) {
      return existing
    }

    const bridgePromise = RadonRuntimeBridgeServer.create()
    this.bridgePromises.set(projectPath, bridgePromise)
    return bridgePromise
  }
}
