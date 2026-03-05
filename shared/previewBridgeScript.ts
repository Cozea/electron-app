/**
 * Preview Bridge Script
 *
 * Shared string injected into preview iframes to enable:
 * - Element inspection (click-to-select with highlight overlay)
 * - Computed style extraction
 * - Screenshot capture via html2canvas
 * - Live style updates via postMessage
 *
 * Kept in `shared/` so both the Electron main process and the renderer can use
 * the exact same script source.
 */

/** CSS properties we extract from computed styles */
const STYLE_PROPERTIES = [
  'display', 'position', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'overflow', 'cursor', 'zIndex',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign',
  'textDecoration', 'textTransform',
  'color', 'backgroundColor',
  'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'border', 'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'boxShadow', 'opacity', 'transform', 'transition',
  'flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap', 'flexGrow', 'flexShrink',
] as const

const OFFSCREEN_SCREENSHOT_ENCODING_ENABLED = (() => {
  const raw =
    (typeof process !== 'undefined' ? process.env.VITE_FF_OFFSCREEN_SCREENSHOT : undefined) ??
    (globalThis as { __COZEA_OFFSCREEN_SCREENSHOT_FLAG__?: string | undefined }).__COZEA_OFFSCREEN_SCREENSHOT_FLAG__
  const normalized = raw?.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return true
})()

/**
 * Bridge script to inject into preview iframes (as string)
 * Self-contained - no external dependencies except html2canvas loaded dynamically.
 */
export const BRIDGE_SCRIPT = `
(function() {
  // Prevent double initialization
  if (window.__COZEA_BRIDGE_LOADED__) {
    console.log('[Cozea Bridge] Skipping initialization because bridge is already loaded');
    return;
  }
  window.__COZEA_BRIDGE_LOADED__ = true;

  let inspectorEnabled = false;
  let highlightOverlay = null;
  let selectedOverlay = null;
  let highlightLabel = null;
  let selectedLabel = null;
  let currentSelectedElement = null;
  let lastContextMenuTime = 0;
  let selectedTrackRaf = null;
  let lastSelectedRect = null;
  const BRIDGE_INSTANCE_ID = Math.random().toString(36).slice(2, 10);
  const BRIDGE_FRAME_NAME = window.name || '(unnamed)';
  const BRIDGE_LOG_PREFIX = '[Cozea Bridge]';
  const TRACE_POST_TYPES = {
    'bridge:ready': true,
    'bridge:close-inspector': true,
    'bridge:shift-keydown': true,
    'bridge:shift-keyup': true,
    'bridge:element-selected': true,
    'bridge:element-contextmenu': true,
    'bridge:selection-cleared': true,
    'bridge:screenshot-ready': true,
    'bridge:style-update-ack': true,
    'bridge:navigation': true,
    'bridge:runtime-error': true,
  };
  const OFFSCREEN_SCREENSHOT_ENCODING_ENABLED = ${JSON.stringify(OFFSCREEN_SCREENSHOT_ENCODING_ENABLED)};

  function bridgeLog(message, details) {
    try {
      if (typeof details === 'undefined') {
        console.log(BRIDGE_LOG_PREFIX, message);
      } else {
        console.log(BRIDGE_LOG_PREFIX, message, details);
      }
    } catch (_err) {
      // ignore
    }
  }

  bridgeLog('Initializing bridge runtime', {
    href: window.location.href,
    origin: window.location.origin,
    frameName: BRIDGE_FRAME_NAME,
    instanceId: BRIDGE_INSTANCE_ID,
  });

  // Create highlight overlay element
  function createOverlay(id, color) {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = \`
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      border: 2px solid \${color};
      background: transparent;
      transition: all 0.05s ease;
      display: none;
      box-sizing: border-box;
    \`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create inspector label shown above the selector border
  function createLabel(id, color) {
    const label = document.createElement('div');
    label.id = id;
    label.style.cssText = \`
      position: fixed;
      pointer-events: none;
      z-index: 1000000;
      border: 1px solid \${color};
      background: \${color};
      color: #ffffff;
      border-radius: 6px;
      padding: 4px 6px;
      display: none;
      box-sizing: border-box;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      max-width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    \`;

    const title = document.createElement('div');
    title.setAttribute('data-role', 'title');
    title.style.cssText = 'font-size: 11px; line-height: 1.15; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    const subtitle = document.createElement('div');
    subtitle.setAttribute('data-role', 'subtitle');
    subtitle.style.cssText = 'margin-top: 1px; font-size: 10px; line-height: 1.1; opacity: 0.88; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    label.appendChild(title);
    label.appendChild(subtitle);
    document.body.appendChild(label);
    return label;
  }

  function getLabelParts(el) {
    const title = (el.tagName || 'element').toLowerCase();
    let subtitle = '';

    if (el.id && String(el.id).trim()) {
      subtitle = '#' + String(el.id).trim();
    } else if (typeof el.className === 'string' && el.className.trim()) {
      const classes = el.className
        .split(/\\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (classes.length) {
        subtitle = '.' + classes.join('.');
      }
    }

    return { title, subtitle };
  }

  function setLabelContent(label, el) {
    if (!label || !el) return;
    const titleNode = label.querySelector('[data-role="title"]');
    const subtitleNode = label.querySelector('[data-role="subtitle"]');
    if (!titleNode || !subtitleNode) return;

    const { title, subtitle } = getLabelParts(el);
    titleNode.textContent = title;
    subtitleNode.textContent = subtitle;
    subtitleNode.style.display = subtitle ? 'block' : 'none';
  }

  function positionLabel(label, rect) {
    if (!label) return;
    label.style.display = 'block';

    const margin = 4;
    const labelRect = label.getBoundingClientRect();
    const left = Math.max(
      margin,
      Math.min(rect.x, window.innerWidth - labelRect.width - margin)
    );
    const top = Math.max(margin, rect.y - labelRect.height - 6);

    label.style.left = left + 'px';
    label.style.top = top + 'px';
  }

  function showIndicator(overlay, label, el, rect) {
    positionOverlay(overlay, rect);
    setLabelContent(label, el);
    positionLabel(label, rect);
  }

  function hideIndicator(overlay, label) {
    if (overlay) overlay.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  // Position overlay over element
  function positionOverlay(overlay, rect) {
    if (!overlay) return;
    overlay.style.display = 'block';
    overlay.style.left = rect.x + 'px';
    overlay.style.top = rect.y + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function updateSelectedOverlay() {
    if (!currentSelectedElement || !selectedOverlay) return;
    const rect = currentSelectedElement.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideIndicator(selectedOverlay, selectedLabel);
      return;
    }
    if (
      !lastSelectedRect ||
      rect.x !== lastSelectedRect.x ||
      rect.y !== lastSelectedRect.y ||
      rect.width !== lastSelectedRect.width ||
      rect.height !== lastSelectedRect.height
    ) {
      positionOverlay(selectedOverlay, rect);
      positionLabel(selectedLabel, rect);
      lastSelectedRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
  }

  function startSelectionTracking() {
    if (selectedTrackRaf) return;
    const tick = () => {
      if (!inspectorEnabled || !currentSelectedElement) {
        selectedTrackRaf = null;
        return;
      }
      updateSelectedOverlay();
      selectedTrackRaf = requestAnimationFrame(tick);
    };
    selectedTrackRaf = requestAnimationFrame(tick);
  }

  function stopSelectionTracking() {
    if (selectedTrackRaf) {
      cancelAnimationFrame(selectedTrackRaf);
      selectedTrackRaf = null;
    }
    lastSelectedRect = null;
  }

  // Generate CSS selector for element
  function getSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    while (el && el !== document.body && el !== document.documentElement) {
      let selector = el.tagName.toLowerCase();

      // Add first meaningful class if available
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ')
          .filter(c => c && !c.startsWith('_') && c.length < 30)
          .slice(0, 2);
        if (classes.length) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      parts.unshift(selector);
      el = el.parentElement;
    }

    return parts.join(' > ');
  }

  // Get computed styles for element
  function getComputedStylesMap(el) {
    const computed = window.getComputedStyle(el);
    const props = ${JSON.stringify(STYLE_PROPERTIES)};
    const styles = {};
    for (const prop of props) {
      try {
        styles[prop] = computed[prop] || '';
      } catch (e) {
        styles[prop] = '';
      }
    }
    return styles;
  }

  // Get element path (indices) for re-selection
  function getElementPath(el) {
    const path = [];
    while (el && el !== document.body && el !== document.documentElement) {
      const parent = el.parentElement;
      if (parent) {
        const index = Array.from(parent.children).indexOf(el);
        path.unshift(index);
      }
      el = parent;
    }
    return path;
  }

  // Try to extract a React component stack for a DOM element (dev-only, best-effort)
  function getReactComponentInfo(el) {
    try {
      if (!el) return null;
      const keys = Object.keys(el);
      const fiberKey = keys.find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!fiberKey) return null;
      let fiber = el[fiberKey];
      if (!fiber) return null;

      function getFiberName(f) {
        const type = f && (f.type || f.elementType);
        if (!type) return null;
        if (typeof type === 'string') return null; // host components (div/span)
        if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
        if (typeof type === 'object') {
          // memo/forwardRef
          const render = type.render;
          return type.displayName || (render && (render.displayName || render.name)) || type.name || 'Anonymous';
        }
        return null;
      }

      const componentStack = [];
      let debugSource = null;
      let current = fiber;
      let depth = 0;

      while (current && depth < 20) {
        const name = getFiberName(current);
        if (name) componentStack.push(name);
        if (!debugSource && current._debugSource) {
          debugSource = current._debugSource;
        }
        current = current.return;
        depth++;
      }

      if (!componentStack.length && !debugSource) return null;
      const safeSource = debugSource ? {
        fileName: debugSource.fileName,
        lineNumber: debugSource.lineNumber,
        columnNumber: debugSource.columnNumber
      } : null;

      return {
        componentStack: componentStack.slice(0, 10),
        source: safeSource
      };
    } catch (_err) {
      return null;
    }
  }

  // Send message to parent window
  function postToParent(message) {
    try {
      const messageWithMeta = message && typeof message === 'object'
        ? Object.assign({}, message, {
            __cozeaBridgeMeta: {
              frameName: BRIDGE_FRAME_NAME,
              href: window.location.href,
              instanceId: BRIDGE_INSTANCE_ID,
            }
          })
        : message;

      if (messageWithMeta && TRACE_POST_TYPES[messageWithMeta.type]) {
        bridgeLog('postMessage -> parent', {
          type: messageWithMeta.type,
          frameName: BRIDGE_FRAME_NAME,
          instanceId: BRIDGE_INSTANCE_ID,
        });
      }
      window.parent.postMessage(messageWithMeta, '*');
    } catch (e) {
      console.warn('[Bridge] Failed to post message:', e);
    }
  }

  function formatConsoleArg(arg) {
    if (arg instanceof Error) {
      return { message: arg.message || 'Error', stack: arg.stack || '' };
    }
    if (typeof arg === 'string') {
      return { message: arg, stack: '' };
    }
    try {
      return { message: JSON.stringify(arg), stack: '' };
    } catch (_err) {
      return { message: String(arg), stack: '' };
    }
  }

  function emitConsole(level, args) {
    try {
      const parts = [];
      let stack = '';
      for (const arg of args) {
        const formatted = formatConsoleArg(arg);
        parts.push(formatted.message);
        if (!stack && formatted.stack) stack = formatted.stack;
      }
      const message = parts.join(' ').trim();
      if (!message) return;
      postToParent({
        type: 'bridge:console',
        payload: { level, message, stack }
      });
    } catch (_err) {
      // ignore
    }
  }

  // Forward console errors/warnings to host
  try {
    const originalConsoleError = console.error.bind(console);
    console.error = function(...args) {
      originalConsoleError(...args);
      emitConsole('error', args);
    };
    const originalConsoleWarn = console.warn.bind(console);
    console.warn = function(...args) {
      originalConsoleWarn(...args);
      emitConsole('warn', args);
    };
    const originalConsoleInfo = console.info.bind(console);
    console.info = function(...args) {
      originalConsoleInfo(...args);
      emitConsole('info', args);
    };
  } catch (_err) {
    // ignore
  }

  // Forward runtime errors to host
  window.addEventListener('error', function(event) {
    try {
      const error = event.error;
      postToParent({
        type: 'bridge:runtime-error',
        payload: {
          message: event.message || (error && error.message) || 'Runtime error',
          stack: error && error.stack ? error.stack : '',
          filename: event.filename || '',
          line: event.lineno || null,
          column: event.colno || null
        }
      });
    } catch (_err) {
      // ignore
    }
  });

  window.addEventListener('unhandledrejection', function(event) {
    try {
      const reason = event.reason;
      const formatted = formatConsoleArg(reason);
      postToParent({
        type: 'bridge:runtime-error',
        payload: {
          message: formatted.message || 'Unhandled promise rejection',
          stack: formatted.stack || '',
          filename: '',
          line: null,
          column: null
        }
      });
    } catch (_err) {
      // ignore
    }
  });

  // Handle mouse move during inspection
  function handleMouseMove(e) {
    if (!inspectorEnabled) return;
    if (currentSelectedElement) {
      hideIndicator(highlightOverlay, highlightLabel);
      return;
    }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (
      !el ||
      el === highlightOverlay ||
      el === selectedOverlay ||
      el === highlightLabel ||
      el === selectedLabel ||
      el === document.documentElement
    ) return;

    const rect = el.getBoundingClientRect();
    showIndicator(highlightOverlay, highlightLabel, el, rect);

    postToParent({
      type: 'bridge:element-hover',
      payload: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || '',
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    });
  }

  function hideHoverOverlay() {
    hideIndicator(highlightOverlay, highlightLabel);
  }

  // Handle click during inspection
  function handleClick(e) {
    if (!inspectorEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightOverlay || el === selectedOverlay || el === document.documentElement) return;
    if (currentSelectedElement === el) {
      clearSelection();
      postToParent({ type: 'bridge:selection-cleared' });
      return;
    }

    currentSelectedElement = el;
    const rect = el.getBoundingClientRect();

    // Show selection overlay, hide hover
    showIndicator(selectedOverlay, selectedLabel, el, rect);
    hideIndicator(highlightOverlay, highlightLabel);
    startSelectionTracking();

    postToParent({
      type: 'bridge:element-selected',
      payload: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || '',
        id: el.id || undefined,
        selector: getSelector(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: getComputedStylesMap(el),
        htmlSnippet: el.outerHTML.slice(0, 500),
        textContent: el.textContent?.trim().slice(0, 200),
        path: getElementPath(el)
      }
    });
  }

  // Handle right-click during inspection (captures context)
  function handleContextMenu(e) {
    if (!inspectorEnabled) return;

    // Throttle: some apps fire multiple contextmenu events rapidly
    const now = Date.now();
    if (now - lastContextMenuTime < 150) return;
    lastContextMenuTime = now;

    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (
      !el ||
      el === highlightOverlay ||
      el === selectedOverlay ||
      el === highlightLabel ||
      el === selectedLabel ||
      el === document.documentElement
    ) return;

    currentSelectedElement = el;
    const rect = el.getBoundingClientRect();

    // Show selection overlay, hide hover
    showIndicator(selectedOverlay, selectedLabel, el, rect);
    hideIndicator(highlightOverlay, highlightLabel);
    startSelectionTracking();

    postToParent({
      type: 'bridge:element-contextmenu',
      payload: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || '',
        id: el.id || undefined,
        selector: getSelector(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: getComputedStylesMap(el),
        htmlSnippet: el.outerHTML.slice(0, 500),
        textContent: el.textContent?.trim().slice(0, 200),
        path: getElementPath(el),
        clientX: e.clientX,
        clientY: e.clientY,
        react: getReactComponentInfo(el),
      }
    });
  }

  // Capture screenshot using html2canvas
  async function encodeCanvasInWorker(canvas) {
    if (!OFFSCREEN_SCREENSHOT_ENCODING_ENABLED) return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (typeof window.createImageBitmap !== 'function') return null;

    const workerSource = \`
      self.onmessage = async (event) => {
        const { bitmap, width, height } = event.data || {};
        try {
          const offscreen = new OffscreenCanvas(width, height);
          const context = offscreen.getContext('2d');
          if (!context) throw new Error('Offscreen canvas context unavailable');
          context.drawImage(bitmap, 0, 0, width, height);
          if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
          }
          const blob = await offscreen.convertToBlob({ type: 'image/png', quality: 0.92 });
          const reader = new FileReaderSync();
          const dataUrl = reader.readAsDataURL(blob);
          self.postMessage({ success: true, dataUrl });
        } catch (error) {
          self.postMessage({
            success: false,
            error: error && error.message ? error.message : String(error),
          });
        }
      };
    \`;

    let workerUrl = null;
    let worker = null;

    try {
      const bitmap = await window.createImageBitmap(canvas);
      workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);

      const dataUrl = await new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
          const payload = event.data || {};
          if (payload.success && typeof payload.dataUrl === 'string') {
            resolve(payload.dataUrl);
            return;
          }
          reject(new Error(payload.error || 'Worker screenshot encoding failed'));
        };
        worker.onerror = () => reject(new Error('Worker screenshot encoding crashed'));
        worker.postMessage({ bitmap, width: canvas.width, height: canvas.height }, [bitmap]);
      });

      return dataUrl;
    } catch (_error) {
      return null;
    } finally {
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  }

  async function captureScreenshot() {
    try {
      bridgeLog('Starting screenshot capture');
      // Dynamically load html2canvas if not present
      if (!window.html2canvas) {
        bridgeLog('Loading html2canvas from CDN');
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load html2canvas'));
          document.head.appendChild(script);
        });
      }

      // Hide overlays during capture
      hideIndicator(highlightOverlay, highlightLabel);
      hideIndicator(selectedOverlay, selectedLabel);

      const canvas = await window.html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio || 1,
        logging: false,
        width: window.innerWidth,
        height: window.innerHeight,
      });

      const offThreadDataUrl = await encodeCanvasInWorker(canvas);
      const dataUrl = offThreadDataUrl || canvas.toDataURL('image/png');
      bridgeLog('Screenshot capture completed', { dataUrlLength: dataUrl.length });
      postToParent({
        type: 'bridge:screenshot-ready',
        payload: { dataUrl }
      });
    } catch (err) {
      bridgeLog('Screenshot capture failed', { error: err && err.message ? err.message : String(err) });
      postToParent({
        type: 'bridge:screenshot-ready',
        payload: { error: err.message || 'Screenshot capture failed' }
      });
    }
  }

  // Apply style update to selected element
  function applyStyleUpdate(styles) {
    if (!currentSelectedElement) {
      bridgeLog('host:update-style ignored: no selected element');
      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: false, error: 'No element selected' }
      });
      return;
    }

    try {
      bridgeLog('Applying style update', { styleCount: Object.keys(styles || {}).length });
      for (const [prop, value] of Object.entries(styles)) {
        currentSelectedElement.style[prop] = value;
      }

      // Update selection overlay position in case size changed
      const rect = currentSelectedElement.getBoundingClientRect();
      positionOverlay(selectedOverlay, rect);
      positionLabel(selectedLabel, rect);

      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: true }
      });
    } catch (err) {
      bridgeLog('Style update failed', { error: err && err.message ? err.message : String(err) });
      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: false, error: err.message }
      });
    }
  }

  // Clear selection
  function clearSelection() {
    currentSelectedElement = null;
    hideIndicator(selectedOverlay, selectedLabel);
    hideIndicator(highlightOverlay, highlightLabel);
    stopSelectionTracking();
    bridgeLog('Selection cleared');
  }

  // Listen for messages from parent
  window.addEventListener('message', (e) => {
    const { type, payload } = e.data || {};
    if (typeof type === 'string' && type.startsWith('host:')) {
      bridgeLog('message <- host', { type: type });
    }

    switch (type) {
      case 'host:enable-inspector':
        inspectorEnabled = true;
        if (!highlightOverlay) highlightOverlay = createOverlay('cozea-highlight', '#3b82f6');
        if (!selectedOverlay) selectedOverlay = createOverlay('cozea-selected', '#22c55e');
        if (!highlightLabel) highlightLabel = createLabel('cozea-highlight-label', '#3b82f6');
        if (!selectedLabel) selectedLabel = createLabel('cozea-selected-label', '#22c55e');
        document.body.style.cursor = 'crosshair';
        bridgeLog('Inspector enabled');
        break;

      case 'host:disable-inspector':
        inspectorEnabled = false;
        // Clear all overlays and selection state
        clearSelection();
        document.body.style.cursor = '';
        bridgeLog('Inspector disabled');
        break;

      case 'host:request-screenshot':
        bridgeLog('Screenshot requested by host');
        captureScreenshot();
        break;

      case 'host:update-style':
        if (payload && payload.styles) {
          applyStyleUpdate(payload.styles);
        }
        break;

      case 'host:update-text':
        if (payload && typeof payload.text === 'string' && currentSelectedElement) {
          bridgeLog('Applying text update', { textLength: payload.text.length });
          currentSelectedElement.textContent = payload.text;

          // Update selection overlay position in case size changed
          const rect = currentSelectedElement.getBoundingClientRect();
          positionOverlay(selectedOverlay, rect);
          positionLabel(selectedLabel, rect);
        }
        break;

      case 'host:clear-selection':
        bridgeLog('Clear selection requested by host');
        clearSelection();
        break;
    }
  });

  // Attach event listeners (capture phase for inspection)
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('mouseleave', () => {
    if (!inspectorEnabled || currentSelectedElement) return;
    hideHoverOverlay();
  }, true);
  document.addEventListener('mouseout', (e) => {
    if (!inspectorEnabled || currentSelectedElement) return;
    if (!e.relatedTarget) {
      hideHoverOverlay();
    }
  }, true);
  window.addEventListener('scroll', () => {
    if (!inspectorEnabled || currentSelectedElement) return;
    hideHoverOverlay();
  }, true);
  window.addEventListener('blur', () => {
    if (!inspectorEnabled || currentSelectedElement) return;
    hideHoverOverlay();
  });

  // Prevent default on click during inspection
  document.addEventListener('click', (e) => {
    if (inspectorEnabled) {
      e.preventDefault();
    }
  }, false);

  // Prevent default context menu during inspection
  document.addEventListener('contextmenu', (e) => {
    if (inspectorEnabled) {
      e.preventDefault();
    }
  }, false);

  // Escape closes inspector (notify parent so it can disable inspector and clear selection)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inspectorEnabled) {
      e.preventDefault();
      postToParent({ type: 'bridge:close-inspector' });
    }
    // Forward Shift so parent can enable inspector when focus is in iframe (e.g. after Escape)
    if (e.key === 'Shift' && !e.repeat) {
      postToParent({ type: 'bridge:shift-keydown' });
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      postToParent({ type: 'bridge:shift-keyup' });
    }
  }, true);

  // Track navigation changes (supports browser routers and hash routers)
  function normalizeNavigationPath(pathname) {
    if (typeof pathname !== 'string' || pathname.length === 0) return '/';
    let normalized = pathname;
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    normalized = normalized.replace(/\\/{2,}/g, '/');
    if (normalized.length > 1) {
      normalized = normalized.replace(/\\/+$/, '');
    }
    return normalized || '/';
  }

  function extractHashRoutePath() {
    const rawHash = window.location.hash || '';
    if (!rawHash || rawHash === '#') return null;
    const hashContent = rawHash.startsWith('#!') ? rawHash.slice(2) : rawHash.slice(1);
    if (!hashContent.startsWith('/')) return null;
    const hashPath = hashContent.split('?')[0].split('#')[0];
    return normalizeNavigationPath(hashPath);
  }

  function getCurrentNavigationPath() {
    const hashRoutePath = extractHashRoutePath();
    if (hashRoutePath) return hashRoutePath;
    return normalizeNavigationPath(window.location.pathname);
  }

  let lastNavigationPath = getCurrentNavigationPath();

  function notifyNavigation() {
    const newPathname = getCurrentNavigationPath();
    if (newPathname !== lastNavigationPath) {
      bridgeLog('Detected in-frame navigation', {
        from: lastNavigationPath,
        to: newPathname,
      });
      lastNavigationPath = newPathname;
      postToParent({
        type: 'bridge:navigation',
        payload: {
          pathname: newPathname,
          url: window.location.href
        }
      });
    }
  }

  // Override history methods to detect programmatic navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    notifyNavigation();
    return result;
  };

  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    notifyNavigation();
    return result;
  };

  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', notifyNavigation);
  window.addEventListener('hashchange', notifyNavigation);

  // Signal bridge is ready
  bridgeLog('Bridge ready, notifying parent');
  postToParent({ type: 'bridge:ready' });
  console.log('[Cozea] Preview bridge initialized');
})();
`;
