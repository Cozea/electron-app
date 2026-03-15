import { BrowserWindow, type IpcMain, type WebContents, type WebFrameMain } from 'electron'

import { BRIDGE_SCRIPT } from '../../shared/previewBridgeScript'
import { normalizeComputedStyles } from '../../shared/styleProperties'
import type {
  PreviewCaptureScreenshotResult,
  PreviewInspectorElementSnapshot,
  PreviewInspectorMutationResult,
  PreviewInspectorSelectionInput,
  PreviewInspectorSelectionResult,
  PreviewInspectorStyleMutationInput,
  PreviewInspectorTextMutationInput,
  PreviewFailureReason,
  PreviewHeaderDiagnostic,
  PreviewInjectBridgeResult,
  PreviewProbeUrlResult,
} from '../../shared/electronApiTypes'

interface RegisterPreviewHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  getLatestPreviewHeaderDiagnostic?: (url: string) => PreviewHeaderDiagnostic | null
}

interface DebugTargetInfo {
  targetId: string
  type: string
  title: string
  url: string
}

interface TargetGetTargetsResult {
  targetInfos?: DebugTargetInfo[]
}

interface TargetAttachToTargetResult {
  sessionId?: string
}

interface TargetDetachedFromTargetEvent {
  sessionId?: string
  targetId?: string
}

interface RuntimeRemoteObject {
  objectId?: string
  value?: unknown
}

interface RuntimeEvaluateResult {
  result?: RuntimeRemoteObject
}

interface PageFramePayload {
  id: string
  name?: string
  url: string
}

interface PageFrameTreePayload {
  frame: PageFramePayload
  childFrames?: PageFrameTreePayload[]
}

interface PageGetFrameTreeResult {
  frameTree?: PageFrameTreePayload
}

interface PageCreateIsolatedWorldResult {
  executionContextId?: number
}

interface DOMRequestNodeResult {
  nodeId?: number
}

interface DOMDescribeNodeResult {
  node?: {
    nodeId?: number
    backendNodeId?: number
  }
}

interface DOMPushNodesByBackendIdsToFrontendResult {
  nodeIds?: number[]
}

interface CSSComputedStyleProperty {
  name: string
  value: string
}

interface CSSGetComputedStyleForNodeResult {
  computedStyle?: CSSComputedStyleProperty[]
}

interface CSSStyleProperty {
  name?: string
  value?: string
  disabled?: boolean
}

interface CSSStylePayload {
  cssProperties?: CSSStyleProperty[]
}

interface CSSGetInlineStylesForNodeResult {
  inlineStyle?: CSSStylePayload
}

interface RuntimeSnapshotValue {
  tagName?: string
  className?: string
  id?: string
  selector?: string
  path?: number[]
  textContent?: string
  htmlSnippet?: string
  boundingRect?: {
    x: number
    y: number
    width: number
    height: number
  }
}

interface RuntimeCallFunctionOnResult {
  result?: RuntimeRemoteObject
}

interface PreviewInspectorResolvedNode {
  objectId: string | null
  nodeId: number | null
}

interface PreviewInspectorMutationRuntimeValue {
  success?: boolean
  error?: string
}

interface PreviewInspectorExecutionTarget {
  sessionId?: string
  executionContextId?: number
}

class PreviewInspectorService {
  private boundWebContentsId: number | null = null
  private targetSessions = new Map<string, string>()
  private sessionTargets = new Map<string, string>()
  private domDocumentReadySessions = new Set<string>()
  private debuggerMessageHandler?: (event: Electron.Event, method: string, params: unknown, sessionId: string) => void
  private debuggerDetachHandler?: (event: Electron.Event, reason: string) => void

  constructor(private readonly deps: RegisterPreviewHandlersDeps) {}

  private log(event: string, details?: Record<string, unknown>): void {
    if (typeof details === 'undefined') {
      console.log(`[PreviewInspector][Main] ${event}`)
      return
    }
    console.log(`[PreviewInspector][Main] ${event}`, details)
  }

  private warn(event: string, details?: Record<string, unknown>): void {
    if (typeof details === 'undefined') {
      console.warn(`[PreviewInspector][Main] ${event}`)
      return
    }
    console.warn(`[PreviewInspector][Main] ${event}`, details)
  }

  async inspectSelection(input: PreviewInspectorSelectionInput): Promise<PreviewInspectorSelectionResult> {
    try {
      this.log('inspectSelection:start', {
        url: input.url,
        frameName: input.frameName ?? null,
        bridgeInstanceId: input.bridgeInstanceId ?? null,
        selector: input.selector ?? null,
        pathLength: input.path?.length ?? 0,
      })
      const win = await this.ensureDebuggerAttached()
      const target = await this.resolveTargetSession(win, input)
      if (!target) {
        this.warn('inspectSelection:no-target', {
          url: input.url,
          frameName: input.frameName ?? null,
          bridgeInstanceId: input.bridgeInstanceId ?? null,
        })
        return { success: false, error: 'Preview inspector target not found' }
      }

      const node = await this.resolveNodeFromSelection(win, target, input)
      if (!node.objectId) {
        this.warn('inspectSelection:no-node', {
          url: input.url,
          selector: input.selector ?? null,
          path: input.path ?? [],
          targetType: target.sessionId ? 'target-session' : 'frame-context',
          sessionId: target.sessionId ?? null,
          executionContextId: target.executionContextId ?? null,
        })
        return { success: false, error: 'Selected preview element not found in inspector target' }
      }

      const snapshot = await this.captureSelectionSnapshot(win, target, node, input)

      return { success: true, snapshot }
    } catch (error) {
      this.warn('inspectSelection:unexpected-error', {
        url: input.url,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateSelectionStyles(
    input: PreviewInspectorStyleMutationInput,
  ): Promise<PreviewInspectorMutationResult> {
    try {
      const win = await this.ensureDebuggerAttached()
      const target = await this.resolveTargetSession(win, input)
      if (!target) {
        return { success: false, error: 'Preview inspector target not found' }
      }

      const node = await this.resolveNodeFromSelection(win, target, input)
      if (!node.objectId) {
        return { success: false, error: 'Selected preview element not found in inspector target' }
      }

      const mutation = await this.applySelectionStyleMutation(win, target, node.objectId, input.styles)
      if (!mutation.success) {
        await this.releaseObjectGroup(win, target.sessionId)
        return {
          success: false,
          error: mutation.error ?? 'Failed to update preview selection styles',
        }
      }

      const snapshot = await this.captureSelectionSnapshot(win, target, node, input)
      return { success: true, snapshot }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateSelectionText(
    input: PreviewInspectorTextMutationInput,
  ): Promise<PreviewInspectorMutationResult> {
    try {
      const win = await this.ensureDebuggerAttached()
      const target = await this.resolveTargetSession(win, input)
      if (!target) {
        return { success: false, error: 'Preview inspector target not found' }
      }

      const node = await this.resolveNodeFromSelection(win, target, input)
      if (!node.objectId) {
        return { success: false, error: 'Selected preview element not found in inspector target' }
      }

      const mutation = await this.applySelectionTextMutation(win, target, node.objectId, input.text)
      if (!mutation.success) {
        await this.releaseObjectGroup(win, target.sessionId)
        return {
          success: false,
          error: mutation.error ?? 'Failed to update preview selection text',
        }
      }

      const snapshot = await this.captureSelectionSnapshot(win, target, node, input)
      return { success: true, snapshot }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async ensureDebuggerAttached(): Promise<BrowserWindow> {
    const win = this.deps.getMainWindow()
    if (!win) {
      throw new Error('No window available')
    }

    const webContents = win.webContents

    if (this.boundWebContentsId !== webContents.id) {
      this.targetSessions.clear()
      this.sessionTargets.clear()
      this.domDocumentReadySessions.clear()

      this.debuggerMessageHandler = (_event, method, params) => {
        if (method === 'Target.detachedFromTarget') {
          const detached = params as TargetDetachedFromTargetEvent
          if (detached.sessionId) {
            const targetId = this.sessionTargets.get(detached.sessionId)
            if (targetId) this.targetSessions.delete(targetId)
            this.sessionTargets.delete(detached.sessionId)
            this.domDocumentReadySessions.delete(detached.sessionId)
          }
        }
      }

      this.debuggerDetachHandler = () => {
        this.targetSessions.clear()
        this.sessionTargets.clear()
        this.domDocumentReadySessions.clear()
      }

      webContents.debugger.on('message', this.debuggerMessageHandler)
      webContents.debugger.on('detach', this.debuggerDetachHandler)
      this.boundWebContentsId = webContents.id
    }

    await this.ensureDevToolsClosed(webContents)

    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach()
    }

    await Promise.allSettled([
      webContents.debugger.sendCommand('Target.setDiscoverTargets', { discover: true }),
      webContents.debugger.sendCommand('Page.enable'),
      webContents.debugger.sendCommand('DOM.enable'),
      webContents.debugger.sendCommand('CSS.enable'),
      webContents.debugger.sendCommand('Runtime.enable'),
    ])

    await this.ensureDomDocumentRequested(win)

    return win
  }

  private async ensureDevToolsClosed(webContents: WebContents): Promise<void> {
    if (!webContents.isDevToolsOpened()) {
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        webContents.removeListener('devtools-closed', finish)
        resolve()
      }

      const timeoutId = setTimeout(finish, 500)

      webContents.once('devtools-closed', finish)
      webContents.closeDevTools()
    })
  }

  private async resolveTargetSession(
    win: BrowserWindow,
    input: PreviewInspectorSelectionInput,
  ): Promise<PreviewInspectorExecutionTarget | null> {
    const targetsResult = await win.webContents.debugger.sendCommand('Target.getTargets') as TargetGetTargetsResult
    const targetInfos = targetsResult.targetInfos ?? []
    const exactUrl = this.normalizeUrlForMatch(input.url)
    const pathnameOnly = this.normalizeUrlPathForMatch(input.url)

    let candidates = targetInfos.filter((target) => {
      if (target.type !== 'iframe' && target.type !== 'page') return false
      return this.normalizeUrlForMatch(target.url) === exactUrl
    })

    if (candidates.length === 0) {
      candidates = targetInfos.filter((target) => {
        if (target.type !== 'iframe' && target.type !== 'page') return false
        return this.normalizeUrlPathForMatch(target.url) === pathnameOnly
      })
    }

    if (candidates.length > 0) {
      this.log('resolveTargetSession:target-candidates', {
        url: input.url,
        frameName: input.frameName ?? null,
        bridgeInstanceId: input.bridgeInstanceId ?? null,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 6).map((candidate) => ({
          targetId: candidate.targetId,
          type: candidate.type,
          url: candidate.url,
          title: candidate.title,
        })),
      })
      if (input.bridgeInstanceId) {
        for (const candidate of candidates) {
          const sessionId = await this.attachTargetSession(win, candidate.targetId)
          const instanceId = await this.readSessionStringValue(
            win,
            sessionId,
            'window.__COZEA_BRIDGE_INSTANCE_ID__',
          )
          if (instanceId === input.bridgeInstanceId) {
            return { sessionId }
          }
        }
      }

      if (input.frameName) {
        for (const candidate of candidates) {
          const sessionId = await this.attachTargetSession(win, candidate.targetId)
          const frameName = await this.readSessionStringValue(
            win,
            sessionId,
            'window.__COZEA_BRIDGE_FRAME_NAME__',
          )
          if (frameName === input.frameName) {
            return { sessionId }
          }
        }
      }

      return { sessionId: await this.attachTargetSession(win, candidates[0].targetId) }
    }

    return this.resolveFrameExecutionContext(win, input)
  }

  private async resolveFrameExecutionContext(
    win: BrowserWindow,
    input: PreviewInspectorSelectionInput,
  ): Promise<PreviewInspectorExecutionTarget | null> {
    const frameTreeResult = await win.webContents.debugger.sendCommand('Page.getFrameTree') as PageGetFrameTreeResult
    const frames = flattenPageFrames(frameTreeResult.frameTree)
    const exactUrl = this.normalizeUrlForMatch(input.url)
    const pathnameOnly = this.normalizeUrlPathForMatch(input.url)

    let candidates = frames.filter((frame) => this.normalizeUrlForMatch(frame.url) === exactUrl)
    if (candidates.length === 0) {
      candidates = frames.filter((frame) => this.normalizeUrlPathForMatch(frame.url) === pathnameOnly)
    }
    if (input.frameName) {
      const named = candidates.filter((frame) => (frame.name || '') === input.frameName)
      if (named.length > 0) {
        candidates = named
      }
    }
    if (candidates.length === 0) {
      this.warn('resolveFrameExecutionContext:no-frame-candidates', {
        url: input.url,
        frameName: input.frameName ?? null,
        bridgeInstanceId: input.bridgeInstanceId ?? null,
        frameCount: frames.length,
        frames: frames.slice(0, 8).map((frame) => ({
          id: frame.id,
          name: frame.name ?? '',
          url: frame.url,
        })),
      })
      return null
    }

    this.log('resolveFrameExecutionContext:candidates', {
      url: input.url,
      frameName: input.frameName ?? null,
      bridgeInstanceId: input.bridgeInstanceId ?? null,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 8).map((frame) => ({
        id: frame.id,
        name: frame.name ?? '',
        url: frame.url,
      })),
    })

    for (const candidate of candidates) {
      const isolatedWorld = await win.webContents.debugger.sendCommand(
        'Page.createIsolatedWorld',
        {
          frameId: candidate.id,
          worldName: 'cozea-preview-inspector',
          grantUniveralAccess: true,
        },
      ) as PageCreateIsolatedWorldResult

      const executionContextId = isolatedWorld.executionContextId
      if (!executionContextId) {
        continue
      }

      if (input.bridgeInstanceId) {
        const bridgeInstanceId = await this.readContextStringValue(
          win,
          executionContextId,
          "document.documentElement && document.documentElement.getAttribute('data-cozea-bridge-instance-id')",
        )
        if (bridgeInstanceId === input.bridgeInstanceId) {
          this.log('resolveFrameExecutionContext:matched-by-instance', {
            frameId: candidate.id,
            executionContextId,
            bridgeInstanceId,
          })
          return { executionContextId }
        }
      } else if (input.frameName) {
        const frameName = await this.readContextStringValue(
          win,
          executionContextId,
          "document.documentElement && document.documentElement.getAttribute('data-cozea-bridge-frame-name')",
        )
        if (frameName === input.frameName) {
          this.log('resolveFrameExecutionContext:matched-by-frame-name', {
            frameId: candidate.id,
            executionContextId,
            frameName,
          })
          return { executionContextId }
        }
      } else {
        this.log('resolveFrameExecutionContext:matched-first-candidate', {
          frameId: candidate.id,
          executionContextId,
        })
        return { executionContextId }
      }
    }

    if (candidates.length === 1) {
      const isolatedWorld = await win.webContents.debugger.sendCommand(
        'Page.createIsolatedWorld',
        {
          frameId: candidates[0].id,
          worldName: 'cozea-preview-inspector',
          grantUniveralAccess: true,
        },
      ) as PageCreateIsolatedWorldResult

      if (isolatedWorld.executionContextId) {
        this.log('resolveFrameExecutionContext:matched-single-candidate-fallback', {
          frameId: candidates[0].id,
          executionContextId: isolatedWorld.executionContextId,
        })
        return { executionContextId: isolatedWorld.executionContextId }
      }
    }

    return null
  }

  private async attachTargetSession(win: BrowserWindow, targetId: string): Promise<string> {
    const existing = this.targetSessions.get(targetId)
    if (existing) return existing

    const attached = await win.webContents.debugger.sendCommand(
      'Target.attachToTarget',
      { targetId, flatten: true },
    ) as TargetAttachToTargetResult

    const sessionId = attached.sessionId
    if (!sessionId) {
      throw new Error('Failed to attach preview inspector target session')
    }

    this.targetSessions.set(targetId, sessionId)
    this.sessionTargets.set(sessionId, targetId)

    await Promise.allSettled([
      win.webContents.debugger.sendCommand('DOM.enable', undefined, sessionId),
      win.webContents.debugger.sendCommand('CSS.enable', undefined, sessionId),
      win.webContents.debugger.sendCommand('Runtime.enable', undefined, sessionId),
    ])

    await this.ensureDomDocumentRequested(win, sessionId)

    return sessionId
  }

  private async ensureDomDocumentRequested(
    win: BrowserWindow,
    sessionId?: string,
  ): Promise<void> {
    const cacheKey = sessionId ?? '__root__'
    if (this.domDocumentReadySessions.has(cacheKey)) {
      return
    }

    await win.webContents.debugger.sendCommand(
      'DOM.getDocument',
      { depth: 0, pierce: false },
      sessionId,
    )
    this.domDocumentReadySessions.add(cacheKey)
  }

  private async readSessionStringValue(
    win: BrowserWindow,
    sessionId: string,
    expression: string,
  ): Promise<string | null> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        silent: true,
      },
      sessionId,
    ) as RuntimeEvaluateResult

    return typeof result.result?.value === 'string' ? result.result.value : null
  }

  private async readContextStringValue(
    win: BrowserWindow,
    executionContextId: number,
    expression: string,
  ): Promise<string | null> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        contextId: executionContextId,
        returnByValue: true,
        silent: true,
      },
    ) as RuntimeEvaluateResult

    return typeof result.result?.value === 'string' ? result.result.value : null
  }

  private async resolveNodeFromSelection(
    win: BrowserWindow,
    target: PreviewInspectorExecutionTarget,
    input: PreviewInspectorSelectionInput,
  ): Promise<PreviewInspectorResolvedNode> {
    const diagnosticsExpression = `(() => {
      const marked = document.querySelector('[data-cozea-selected="true"]');
      const path = ${JSON.stringify(input.path ?? null)};
      const selector = ${JSON.stringify(input.selector ?? null)};
      const resolveFromPath = (segments) => {
        if (!Array.isArray(segments) || segments.length === 0) return null;
        let current = document.body;
        for (const segment of segments) {
          if (!current || !current.children || typeof segment !== 'number') return null;
          current = current.children[segment] || null;
        }
        return current instanceof Element ? current : null;
      };
      const fromPath = resolveFromPath(path);
      let fromSelector = null;
      try {
        fromSelector = selector ? document.querySelector(selector) : null;
      } catch (_error) {
        fromSelector = null;
      }
      const describe = (node) => node instanceof Element ? {
        tagName: node.tagName.toLowerCase(),
        id: node.id || null,
        className: typeof node.className === 'string' ? node.className : (node.getAttribute ? node.getAttribute('class') : null),
      } : null;
      return {
        hasMarked: marked instanceof Element,
        marked: describe(marked),
        hasPathMatch: fromPath instanceof Element,
        pathMatch: describe(fromPath),
        hasSelectorMatch: fromSelector instanceof Element,
        selectorMatch: describe(fromSelector),
      };
    })()`

    const diagnosticsResult = await win.webContents.debugger.sendCommand(
      'Runtime.evaluate',
      {
        expression: diagnosticsExpression,
        contextId: target.executionContextId,
        returnByValue: true,
        silent: true,
      },
      target.sessionId,
    ) as RuntimeEvaluateResult

    this.log('resolveNodeFromSelection:diagnostics', {
      selector: input.selector ?? null,
      path: input.path ?? [],
      targetType: target.sessionId ? 'target-session' : 'frame-context',
      sessionId: target.sessionId ?? null,
      executionContextId: target.executionContextId ?? null,
      diagnostics: diagnosticsResult.result?.value ?? null,
    })

    const expression = `(() => {
      const marked = document.querySelector('[data-cozea-selected="true"]');
      if (marked instanceof Element) {
        return marked;
      }

      const path = ${JSON.stringify(input.path ?? null)};
      const selector = ${JSON.stringify(input.selector ?? null)};
      const resolveFromPath = (segments) => {
        if (!Array.isArray(segments) || segments.length === 0) return null;
        let current = document.body;
        for (const segment of segments) {
          if (!current || !current.children || typeof segment !== 'number') return null;
          current = current.children[segment] || null;
        }
        return current instanceof Element ? current : null;
      };
      return resolveFromPath(path) || (selector ? document.querySelector(selector) : null);
    })()`

    const evaluateResult = await win.webContents.debugger.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        contextId: target.executionContextId,
        objectGroup: 'cozea-preview-inspector',
        silent: true,
      },
      target.sessionId,
    ) as RuntimeEvaluateResult

    const objectId = evaluateResult.result?.objectId ?? null
    if (!objectId) {
      this.warn('resolveNodeFromSelection:no-object-id', {
        selector: input.selector ?? null,
        path: input.path ?? [],
        targetType: target.sessionId ? 'target-session' : 'frame-context',
        sessionId: target.sessionId ?? null,
        executionContextId: target.executionContextId ?? null,
      })
      return { objectId: null, nodeId: null }
    }

    // Ensure DOM document is fresh before DOM operations – the cache may be stale
    // after an iframe reload (new bridge instance, new frame content).
    const domCacheKey = target.sessionId ?? '__root__'
    this.domDocumentReadySessions.delete(domCacheKey)
    await this.ensureDomDocumentRequested(win, target.sessionId)

    const describeNodeResult = await win.webContents.debugger.sendCommand(
      'DOM.describeNode',
      { objectId },
      target.sessionId,
    ) as DOMDescribeNodeResult

    let nodeId = describeNodeResult.node?.nodeId ?? null
    const backendNodeId = describeNodeResult.node?.backendNodeId ?? null

    if (!nodeId && backendNodeId) {
      const pushNodesResult = await win.webContents.debugger.sendCommand(
        'DOM.pushNodesByBackendIdsToFrontend',
        { backendNodeIds: [backendNodeId] },
        target.sessionId,
      ) as DOMPushNodesByBackendIdsToFrontendResult
      nodeId = pushNodesResult.nodeIds?.[0] ?? null
    }

    if (!nodeId) {
      const requestNodeResult = await win.webContents.debugger.sendCommand(
        'DOM.requestNode',
        { objectId },
        target.sessionId,
      ) as DOMRequestNodeResult
      nodeId = requestNodeResult.nodeId ?? null
    }

    if (!nodeId) {
      this.warn('resolveNodeFromSelection:no-node-id', {
        selector: input.selector ?? null,
        path: input.path ?? [],
        targetType: target.sessionId ? 'target-session' : 'frame-context',
        sessionId: target.sessionId ?? null,
        executionContextId: target.executionContextId ?? null,
        backendNodeId,
      })
    }

    return {
      objectId,
      nodeId,
    }
  }

  private async captureSelectionSnapshot(
    win: BrowserWindow,
    target: PreviewInspectorExecutionTarget,
    node: PreviewInspectorResolvedNode,
    input: PreviewInspectorSelectionInput,
  ): Promise<PreviewInspectorElementSnapshot> {
    if (!node.objectId) {
      throw new Error('Selected preview element not found in inspector target')
    }

    const styleReadPath = node.nodeId ? 'CSS-domain' : 'Runtime-callFunctionOn'
    const computedStylesPromise = node.nodeId
      ? this.readComputedStyles(win, target.sessionId, node.nodeId)
      : this.readComputedStylesFromObject(win, target.sessionId, node.objectId)
    const inlineStylesPromise = node.nodeId
      ? this.readInlineStyles(win, target.sessionId, node.nodeId)
      : this.readInlineStylesFromObject(win, target.sessionId, node.objectId)
    const runtimeSnapshotPromise = this.readRuntimeSnapshot(win, target.sessionId, node.objectId)

    const [runtimeSnapshot, computedStyles, inlineStyles] = await Promise.all([
      runtimeSnapshotPromise,
      computedStylesPromise,
      inlineStylesPromise,
    ])

    const normalizedComputed = normalizeComputedStyles(computedStyles)
    const normalizedInline = normalizeComputedStyles(inlineStyles)

    this.log('captureSelectionSnapshot:result', {
      selector: input.selector ?? null,
      styleReadPath,
      hasNodeId: !!node.nodeId,
      hasSessionId: !!target.sessionId,
      rawComputedStyleCount: Object.keys(computedStyles).length,
      normalizedComputedStyleCount: Object.keys(normalizedComputed).length,
      normalizedInlineStyleCount: Object.keys(normalizedInline).length,
      textContent: runtimeSnapshot.textContent ?? null,
      sampleStyles: {
        fontSize: normalizedComputed.fontSize ?? null,
        fontWeight: normalizedComputed.fontWeight ?? null,
        color: normalizedComputed.color ?? null,
        textAlign: normalizedComputed.textAlign ?? null,
        paddingTop: normalizedComputed.paddingTop ?? null,
      },
    })

    await this.releaseObjectGroup(win, target.sessionId)

    return {
      tagName: runtimeSnapshot.tagName ?? '',
      className: runtimeSnapshot.className ?? '',
      id: runtimeSnapshot.id,
      selector: runtimeSnapshot.selector ?? input.selector ?? '',
      path: runtimeSnapshot.path ?? input.path ?? [],
      boundingRect: runtimeSnapshot.boundingRect ?? { x: 0, y: 0, width: 0, height: 0 },
      computedStyles: normalizedComputed,
      inlineStyles: normalizedInline,
      htmlSnippet: runtimeSnapshot.htmlSnippet ?? '',
      textContent: runtimeSnapshot.textContent,
    }
  }

  private async applySelectionStyleMutation(
    win: BrowserWindow,
    target: PreviewInspectorExecutionTarget,
    objectId: string,
    styles: Record<string, string>,
  ): Promise<PreviewInspectorMutationRuntimeValue> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function(styles) {
          if (!this || typeof this !== 'object' || !('style' in this)) {
            return { success: false, error: 'Selected preview node does not support inline styles' };
          }

          for (const [property, value] of Object.entries(styles || {})) {
            if (typeof value !== 'string') continue;
            try {
              this.style[property] = value;
            } catch (_error) {
              return { success: false, error: 'Failed to set style "' + property + '"' };
            }
          }

          return { success: true };
        }`,
        arguments: [{ value: styles }],
        returnByValue: true,
        silent: true,
      },
      target.sessionId,
    ) as RuntimeCallFunctionOnResult

    return (result.result?.value as PreviewInspectorMutationRuntimeValue | undefined) ?? { success: false }
  }

  private async applySelectionTextMutation(
    win: BrowserWindow,
    target: PreviewInspectorExecutionTarget,
    objectId: string,
    text: string,
  ): Promise<PreviewInspectorMutationRuntimeValue> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function(text) {
          if (!(this instanceof Element)) {
            return { success: false, error: 'Selected preview node is not a DOM element' };
          }

          this.textContent = typeof text === 'string' ? text : '';
          return { success: true };
        }`,
        arguments: [{ value: text }],
        returnByValue: true,
        silent: true,
      },
      target.sessionId,
    ) as RuntimeCallFunctionOnResult

    return (result.result?.value as PreviewInspectorMutationRuntimeValue | undefined) ?? { success: false }
  }

  private async readRuntimeSnapshot(
    win: BrowserWindow,
    sessionId: string | undefined,
    objectId: string,
  ): Promise<RuntimeSnapshotValue> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function() {
          const normalizeText = (value) => {
            if (typeof value !== 'string') return undefined;
            const normalized = value.replace(/\\s+/g, ' ').trim();
            return normalized ? normalized.slice(0, 800) : undefined;
          };
          const getPath = (el) => {
            const path = [];
            let current = el;
            while (current && current !== document.body && current !== document.documentElement) {
              const parent = current.parentElement;
              if (parent) {
                path.unshift(Array.from(parent.children).indexOf(current));
              }
              current = parent;
            }
            return path;
          };
          const getSelector = (el) => {
            if (!(el instanceof Element)) return '';
            const parts = [];
            let current = el;
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
              const tag = current.tagName.toLowerCase();
              let part = tag;
              if (current.id) {
                part += '#' + current.id;
                parts.unshift(part);
                break;
              }
              if (typeof current.className === 'string' && current.className.trim()) {
                const classes = current.className.trim().split(/\\s+/).slice(0, 2).map((token) =>
                  token.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
                );
                if (classes.length) {
                  part += '.' + classes.join('.');
                }
              }
              const parent = current.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
                if (siblings.length > 1) {
                  part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
                }
              }
              parts.unshift(part);
              current = current.parentElement;
            }
            return parts.join(' > ');
          };
          const rect = this.getBoundingClientRect();
          return {
            tagName: this.tagName ? this.tagName.toLowerCase() : '',
            className: typeof this.className === 'string' ? this.className : '',
            id: this.id || undefined,
            selector: getSelector(this),
            path: getPath(this),
            textContent: normalizeText(typeof this.innerText === 'string' && this.innerText.trim().length > 0 ? this.innerText : this.textContent),
            htmlSnippet: typeof this.outerHTML === 'string' ? this.outerHTML.slice(0, 500) : '',
            boundingRect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          };
        }`,
        returnByValue: true,
        silent: true,
      },
      sessionId,
    ) as RuntimeCallFunctionOnResult

    return (result.result?.value as RuntimeSnapshotValue | undefined) ?? {}
  }

  private async readComputedStyles(
    win: BrowserWindow,
    sessionId: string | undefined,
    nodeId: number,
  ): Promise<Record<string, string>> {
    const result = await win.webContents.debugger.sendCommand(
      'CSS.getComputedStyleForNode',
      { nodeId },
      sessionId,
    ) as CSSGetComputedStyleForNodeResult

    return (result.computedStyle ?? []).reduce<Record<string, string>>((acc, entry) => {
      acc[entry.name] = entry.value
      return acc
    }, {})
  }

  private async readComputedStylesFromObject(
    win: BrowserWindow,
    sessionId: string | undefined,
    objectId: string,
  ): Promise<Record<string, string>> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function() {
          const computed = window.getComputedStyle(this);
          const styles = {};
          for (let index = 0; index < computed.length; index += 1) {
            const property = computed[index];
            styles[property] = computed.getPropertyValue(property);
          }
          return styles;
        }`,
        returnByValue: true,
        silent: true,
      },
      sessionId,
    ) as RuntimeCallFunctionOnResult

    return (result.result?.value as Record<string, string> | undefined) ?? {}
  }

  private async readInlineStyles(
    win: BrowserWindow,
    sessionId: string | undefined,
    nodeId: number,
  ): Promise<Record<string, string>> {
    const result = await win.webContents.debugger.sendCommand(
      'CSS.getInlineStylesForNode',
      { nodeId },
      sessionId,
    ) as CSSGetInlineStylesForNodeResult

    return (result.inlineStyle?.cssProperties ?? []).reduce<Record<string, string>>((acc, property) => {
      if (!property.name || property.disabled) return acc
      acc[property.name] = property.value ?? ''
      return acc
    }, {})
  }

  private async readInlineStylesFromObject(
    win: BrowserWindow,
    sessionId: string | undefined,
    objectId: string,
  ): Promise<Record<string, string>> {
    const result = await win.webContents.debugger.sendCommand(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function() {
          const styles = {};
          if (!this || !this.style) {
            return styles;
          }
          for (let index = 0; index < this.style.length; index += 1) {
            const property = this.style[index];
            styles[property] = this.style.getPropertyValue(property);
          }
          return styles;
        }`,
        returnByValue: true,
        silent: true,
      },
      sessionId,
    ) as RuntimeCallFunctionOnResult

    return (result.result?.value as Record<string, string> | undefined) ?? {}
  }

  private async releaseObjectGroup(win: BrowserWindow, sessionId: string | undefined): Promise<void> {
    await Promise.allSettled([
      win.webContents.debugger.sendCommand(
        'Runtime.releaseObjectGroup',
        { objectGroup: 'cozea-preview-inspector' },
        sessionId,
      ),
    ])
  }

  private normalizeUrlForMatch(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return url
    }
  }

  private normalizeUrlPathForMatch(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.origin}${parsed.pathname}`
    } catch {
      return url
    }
  }
}

function isExpectedPreviewConnectivityError(message: string): boolean {
  return (
    message.includes('ERR_CONNECTION_REFUSED') ||
    message.includes('ERR_CONNECTION_RESET') ||
    message.includes('ERR_NETWORK_CHANGED')
  )
}

async function loadUrlForCapture(
  targetWindow: BrowserWindow,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      targetWindow.webContents.removeListener('did-finish-load', onFinishLoad)
      targetWindow.webContents.removeListener('did-fail-load', onFailLoad)
      callback()
    }

    const onFinishLoad = () => {
      finish(resolve)
    }

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame) return
      finish(() => reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`)))
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Page load timeout')))
    }, timeoutMs)

    targetWindow.webContents.on('did-finish-load', onFinishLoad)
    targetWindow.webContents.on('did-fail-load', onFailLoad)

    void targetWindow.loadURL(targetUrl).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      finish(() => reject(err))
    })
  })
}

function isAllowedPreviewUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

function isChromiumErrorDocumentUrl(url: string): boolean {
  return url.startsWith('chrome-error://')
}

function classifyPreviewFailure(message: string): {
  reason: PreviewFailureReason
  likelyBlocked: boolean
} {
  const normalized = message.toLowerCase()
  if (normalized.includes('err_blocked_by_response') || normalized.includes('blocked by response')) {
    return { reason: 'blocked_response', likelyBlocked: true }
  }
  if (normalized.includes('chrome-error://')) {
    return { reason: 'chrome_error_document', likelyBlocked: true }
  }
  if (normalized.includes('x-frame-options') || normalized.includes('frame-ancestors')) {
    return { reason: 'blocked_response', likelyBlocked: true }
  }
  if (normalized.includes('frame not found')) {
    return { reason: 'frame_not_found', likelyBlocked: false }
  }
  if (normalized.includes('err_network_changed')) {
    return { reason: 'network_quality_degraded', likelyBlocked: false }
  }
  if (
    normalized.includes('err_connection_refused') ||
    normalized.includes('err_connection_reset') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('timeout')
  ) {
    return { reason: 'server_unreachable', likelyBlocked: false }
  }
  return { reason: 'bridge_injection_failed', likelyBlocked: false }
}

async function getFrameLocationHref(frame: WebFrameMain): Promise<string | null> {
  try {
    const href = await frame.executeJavaScript('window.location.href')
    return typeof href === 'string' ? href : null
  } catch {
    return null
  }
}

function summarizePreviewFrames(
  getMainWindow: () => BrowserWindow | null,
  maxFrames = 12
): Array<{
  name: string
  url: string
  frameTreeNodeId: number
  routingId: number
}> {
  const win = getMainWindow()
  if (!win) return []
  return win.webContents.mainFrame.frames
    .filter((frame) => frame !== win.webContents.mainFrame)
    .slice(0, maxFrames)
    .map((frame) => ({
      name: frame.name || '(unnamed)',
      url: frame.url,
      frameTreeNodeId: frame.frameTreeNodeId,
      routingId: frame.routingId,
    }))
}

function flattenPageFrames(frameTree: PageFrameTreePayload | undefined): PageFramePayload[] {
  if (!frameTree) return []

  const result: PageFramePayload[] = []
  const visit = (node: PageFrameTreePayload) => {
    result.push(node.frame)
    for (const child of node.childFrames ?? []) {
      visit(child)
    }
  }

  visit(frameTree)
  return result
}

function getHeaderDiagnostic(
  deps: RegisterPreviewHandlersDeps,
  url: string
): PreviewHeaderDiagnostic | null {
  return deps.getLatestPreviewHeaderDiagnostic ? deps.getLatestPreviewHeaderDiagnostic(url) : null
}

async function findFrameByUrl(
  getMainWindow: () => BrowserWindow | null,
  targetUrl: string,
  options?: { attempts?: number; delayMs?: number; frameName?: string }
): Promise<WebFrameMain | null> {
  const attempts = options?.attempts ?? 15
  const delayMs = options?.delayMs ?? 50
  const frameName = options?.frameName?.trim() || null

  const win = getMainWindow()
  if (!win) return null

  let targetOrigin: string | null = null
  try {
    targetOrigin = new URL(targetUrl).origin
  } catch {
    targetOrigin = null
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const frames = win.webContents.mainFrame.frames.filter((frame) => frame !== win.webContents.mainFrame)
    const namedFrames = frameName ? frames.filter((frame) => frame.name === frameName) : frames
    const candidates = frameName ? namedFrames : frames

    if (frameName && candidates.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    const exact = candidates.find((frame) => frame.url === targetUrl)
    if (exact) return exact

    if (targetOrigin) {
      const sameOrigin = candidates.find((frame) => {
        try {
          return new URL(frame.url).origin === targetOrigin
        } catch {
          return false
        }
      })
      if (sameOrigin) return sameOrigin
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return null
}

export function registerPreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterPreviewHandlersDeps
): void {
  const inspectorService = new PreviewInspectorService(deps)

  // Inject the preview bridge into the project's dev-server iframe (cross-origin safe via WebFrameMain)
  ipcMain.handle(
    'preview:injectBridge',
    async (
      _event,
      { url, frameName }: { url: string; frameName?: string }
    ): Promise<PreviewInjectBridgeResult> => {
      try {
        console.log('[PreviewBridge][Main] Injection requested', {
          url,
          frameName: frameName || '(none)',
        })

        const win = deps.getMainWindow()
        if (!win) {
          return {
            success: false,
            error: 'No window available',
            reason: 'window_unavailable',
            likelyBlocked: false,
            headerDiagnostic: typeof url === 'string' ? getHeaderDiagnostic(deps, url) : null,
          }
        }
        if (!url || typeof url !== 'string') {
          return {
            success: false,
            error: 'Missing url',
            reason: 'invalid_url',
            likelyBlocked: false,
            headerDiagnostic: null,
          }
        }

        let parsedUrl: URL
        try {
          parsedUrl = new URL(url)
        } catch {
          return {
            success: false,
            error: 'Invalid url',
            reason: 'invalid_url',
            likelyBlocked: false,
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        if (!isAllowedPreviewUrl(parsedUrl)) {
          return {
            success: false,
            error: 'Only localhost preview URLs are supported',
            reason: 'unsupported_origin',
            likelyBlocked: false,
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        try {
          const mainUrl = win.webContents.getURL()
          const mainOrigin = new URL(mainUrl).origin
          if (mainOrigin === parsedUrl.origin) {
            return {
              success: false,
              error: 'Refusing to inject into main frame origin',
              reason: 'unsupported_origin',
              likelyBlocked: false,
              headerDiagnostic: getHeaderDiagnostic(deps, url),
            }
          }
        } catch {
          // Ignore parse errors (e.g. about:blank during startup)
        }

        const frame = await findFrameByUrl(deps.getMainWindow, url, { frameName })
        if (!frame) {
          const availableFrames = summarizePreviewFrames(deps.getMainWindow)
          console.warn('[PreviewBridge][Main] Frame not found for injection', {
            url,
            frameName: frameName || '(none)',
            availableFrames,
          })
          return {
            success: false,
            error: 'Preview frame not found',
            reason: 'frame_not_found',
            likelyBlocked: false,
            frame: {
              requestedFrameName: frameName,
              availableFrames,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        const frameHref = await getFrameLocationHref(frame)
        if (frameHref && isChromiumErrorDocumentUrl(frameHref)) {
          console.warn('[PreviewBridge][Main] Refusing injection into Chromium error document', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            frameHref,
          })
          return {
            success: false,
            error: 'Preview frame resolved to Chromium error document (ERR_BLOCKED_BY_RESPONSE)',
            reason: 'chrome_error_document',
            likelyBlocked: true,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameHref,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        try {
          console.log('[PreviewBridge][Main] Matched frame', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            frameTreeNodeId: frame.frameTreeNodeId,
            routingId: frame.routingId,
          })

          const bridgeAlreadyLoaded = await frame.executeJavaScript('Boolean(window.__COZEA_BRIDGE_LOADED__)')
          if (!bridgeAlreadyLoaded) {
            await frame.executeJavaScript(BRIDGE_SCRIPT)
          }

          const postInjectHref = await getFrameLocationHref(frame)
          if (postInjectHref && isChromiumErrorDocumentUrl(postInjectHref)) {
            console.warn('[PreviewBridge][Main] Bridge injection landed on Chromium error document', {
              requestedUrl: url,
              requestedFrameName: frameName || '(none)',
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameHref: postInjectHref,
            })
            return {
              success: false,
              error: 'Preview frame is Chromium error document after injection (ERR_BLOCKED_BY_RESPONSE)',
              reason: 'blocked_response',
              likelyBlocked: true,
              frame: {
                requestedFrameName: frameName,
                matchedFrameName: frame.name || '(unnamed)',
                matchedFrameUrl: frame.url,
                frameHref: postInjectHref,
                frameTreeNodeId: frame.frameTreeNodeId,
                routingId: frame.routingId,
              },
              headerDiagnostic: getHeaderDiagnostic(deps, url),
            }
          }

          console.log('[PreviewBridge][Main] Bridge script injected successfully', {
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
          })
          return {
            success: true,
            reason: 'none',
            likelyBlocked: false,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to inject preview bridge'
          const classified = classifyPreviewFailure(message)
          console.error('[PreviewBridge][Main] Bridge script injection failed', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            error: message,
          })
          return {
            success: false,
            error: message,
            reason: classified.reason,
            likelyBlocked: classified.likelyBlocked,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Preview bridge injection failed unexpectedly'
        const classified = classifyPreviewFailure(message)
        console.error('[PreviewBridge][Main] Unexpected injection handler failure', {
          requestedUrl: url,
          requestedFrameName: frameName || '(none)',
          error: message,
        })
        return {
          success: false,
          error: message,
          reason: classified.reason,
          likelyBlocked: classified.likelyBlocked,
          headerDiagnostic: typeof url === 'string' ? getHeaderDiagnostic(deps, url) : null,
        }
      }
    }
  )

  ipcMain.handle(
    'preview:inspectSelection',
    async (
      _event,
      input: PreviewInspectorSelectionInput,
    ): Promise<PreviewInspectorSelectionResult> => {
      return inspectorService.inspectSelection(input)
    }
  )

  ipcMain.handle(
    'preview:updateSelectionStyles',
    async (
      _event,
      input: PreviewInspectorStyleMutationInput,
    ): Promise<PreviewInspectorMutationResult> => {
      return inspectorService.updateSelectionStyles(input)
    }
  )

  ipcMain.handle(
    'preview:updateSelectionText',
    async (
      _event,
      input: PreviewInspectorTextMutationInput,
    ): Promise<PreviewInspectorMutationResult> => {
      return inspectorService.updateSelectionText(input)
    }
  )

  ipcMain.handle(
    'preview:probeUrl',
    async (
      _event,
      { url, timeoutMs = 2500 }: { url: string; timeoutMs?: number }
    ): Promise<PreviewProbeUrlResult> => {
      const startedAt = Date.now()
      if (!url || typeof url !== 'string') {
        return {
          success: false,
          url: url || '',
          reachable: false,
          reason: 'invalid_url',
          error: 'Missing url',
          elapsedMs: Date.now() - startedAt,
        }
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return {
          success: false,
          url,
          reachable: false,
          reason: 'invalid_url',
          error: 'Invalid url',
          elapsedMs: Date.now() - startedAt,
        }
      }

      if (!isAllowedPreviewUrl(parsedUrl)) {
        return {
          success: false,
          url,
          reachable: false,
          reason: 'unsupported_origin',
          error: 'Only localhost preview URLs are supported',
          elapsedMs: Date.now() - startedAt,
        }
      }

      const boundedTimeoutMs = Math.max(250, Math.min(timeoutMs, 15_000))
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), boundedTimeoutMs)

      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        })

        return {
          success: true,
          url,
          reachable: true,
          statusCode: response.status,
          finalUrl: response.url,
          reason: 'none',
          elapsedMs: Date.now() - startedAt,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const classified = classifyPreviewFailure(message)
        return {
          success: false,
          url,
          reachable: false,
          reason: classified.reason === 'bridge_injection_failed' ? 'server_unreachable' : classified.reason,
          error: message,
          elapsedMs: Date.now() - startedAt,
        }
      } finally {
        clearTimeout(timeoutHandle)
      }
    }
  )

  // Capture a screenshot of a URL using a hidden BrowserWindow
  ipcMain.handle(
    'preview:captureScreenshot',
    async (
      _event,
      { url, width = 1280, height = 800 }: { url: string; width?: number; height?: number }
    ): Promise<PreviewCaptureScreenshotResult> => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return { success: false, error: 'Invalid URL' }
      }

      if (!isAllowedPreviewUrl(parsedUrl)) {
        return { success: false, error: 'Only localhost URLs are supported' }
      }

      const captureWindow = new BrowserWindow({
        width,
        height,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: true,
        },
      })

      try {
        // Load the URL with explicit timeout + listener cleanup to avoid unhandled rejections.
        await loadUrlForCapture(captureWindow, url, 30000)

        // Wait a bit for any animations/rendering to complete.
        await new Promise((resolve) => setTimeout(resolve, 500))

        const image = await captureWindow.webContents.capturePage()
        const base64 = image.toPNG().toString('base64')

        return { success: true, base64 }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Screenshot capture failed'
        if (!isExpectedPreviewConnectivityError(message)) {
          console.error('[Preview] Screenshot capture failed:', error)
        }
        return { success: false, error: message }
      } finally {
        captureWindow.destroy()
      }
    }
  )
}
