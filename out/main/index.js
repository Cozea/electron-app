"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const node_url = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const ripgrep = require("@vscode/ripgrep");
const xxhashInit = require("xxhash-wasm");
const pty = require("node-pty");
const node_crypto = require("node:crypto");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
function notifyFileChanged(filePath, content, options) {
  electron.BrowserWindow.getAllWindows().forEach((window) => {
    const payload = {
      filePath,
      content,
      origin: options?.origin
    };
    window.webContents.send("yjs:external-file-change", payload);
  });
}
function notifyFileDeleted(filePath, options) {
  electron.BrowserWindow.getAllWindows().forEach((window) => {
    const payload = {
      filePath,
      origin: options?.origin
    };
    window.webContents.send("yjs:external-file-delete", payload);
  });
}
const INTERNAL_IGNORE_MS = 1500;
const PROCESS_DEBOUNCE_MS = 200;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
  ".vite"
]);
const BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "pdf",
  "zip",
  "gz",
  "tar",
  "rar",
  "7z",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "avi",
  "webm",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "wasm"
]);
function isBinaryPath(filePath) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "";
  return !!ext && BINARY_EXTENSIONS.has(ext);
}
function normalizeRelativePath(relPath) {
  return relPath.replace(/\\/g, "/");
}
function shouldIgnoreRelativePath(relPath) {
  const normalized = normalizeRelativePath(relPath);
  const parts = normalized.split("/");
  return parts.some((segment) => DEFAULT_EXCLUDED_DIRS.has(segment));
}
const internalWriteTimestamps = /* @__PURE__ */ new Map();
function markInternalFsChange(fullPath) {
  internalWriteTimestamps.set(fullPath, Date.now());
}
function isRecentInternalChange(fullPath) {
  const ts = internalWriteTimestamps.get(fullPath);
  if (!ts) return false;
  if (Date.now() - ts > INTERNAL_IGNORE_MS) {
    internalWriteTimestamps.delete(fullPath);
    return false;
  }
  return true;
}
const watchersByProjectPath = /* @__PURE__ */ new Map();
function scheduleProcess(handle, fullPath) {
  const existing = handle.pendingTimers.get(fullPath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    handle.pendingTimers.delete(fullPath);
    processPath(handle, fullPath);
  }, PROCESS_DEBOUNCE_MS);
  handle.pendingTimers.set(fullPath, timer);
}
function processPath(handle, fullPath) {
  if (isRecentInternalChange(fullPath)) return;
  const rel = path.relative(handle.projectPath, fullPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  const relNormalized = normalizeRelativePath(rel);
  if (shouldIgnoreRelativePath(relNormalized)) return;
  try {
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      if (handle.watcherType === "manual") {
        void ensureDirWatched(handle, fullPath);
      }
      return;
    }
    if (!stats.isFile()) return;
    if (stats.size > MAX_TEXT_FILE_BYTES) return;
    if (isBinaryPath(relNormalized)) return;
    const content = fs.readFileSync(fullPath, "utf-8");
    notifyFileChanged(fullPath, content, { origin: "external" });
  } catch {
    notifyFileDeleted(fullPath, { origin: "external" });
    if (handle.watcherType === "manual") {
      const prefix = `${path.resolve(fullPath)}${path.sep}`;
      for (const [dirPath, watcher] of handle.dirWatchers.entries()) {
        if (dirPath === fullPath || dirPath.startsWith(prefix)) {
          try {
            watcher.close();
          } catch {
          }
          handle.dirWatchers.delete(dirPath);
        }
      }
    }
  }
}
function handleWatchEvent(handle, baseDir, _eventType, filename) {
  if (!filename) return;
  const fullPath = path.resolve(baseDir, filename.toString());
  scheduleProcess(handle, fullPath);
}
function walkDirectories(rootDir, onDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    onDir(current);
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) continue;
      const next = path.join(current, entry.name);
      stack.push(next);
    }
  }
}
async function ensureDirWatched(handle, dirPath) {
  const resolved = path.resolve(dirPath);
  if (handle.dirWatchers.has(resolved)) return;
  try {
    const watcher = fs.watch(resolved, (eventType, filename) => {
      handleWatchEvent(handle, resolved, eventType, filename);
    });
    handle.dirWatchers.set(resolved, watcher);
  } catch {
  }
  walkDirectories(resolved, (subDir) => {
    if (subDir === resolved) return;
    if (handle.dirWatchers.has(subDir)) return;
    try {
      const subWatcher = fs.watch(subDir, (eventType, filename) => {
        handleWatchEvent(handle, subDir, eventType, filename);
      });
      handle.dirWatchers.set(subDir, subWatcher);
    } catch {
    }
  });
}
function createProjectWatchHandle(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath);
  try {
    const handle2 = {
      projectPath: resolvedProjectPath,
      refCount: 1,
      watcherType: "recursive",
      rootWatcher: null,
      dirWatchers: /* @__PURE__ */ new Map(),
      pendingTimers: /* @__PURE__ */ new Map()
    };
    handle2.rootWatcher = fs.watch(
      resolvedProjectPath,
      { recursive: true },
      (eventType, filename) => {
        handleWatchEvent(handle2, resolvedProjectPath, eventType, filename);
      }
    );
    return handle2;
  } catch {
  }
  const handle = {
    projectPath: resolvedProjectPath,
    refCount: 1,
    watcherType: "manual",
    rootWatcher: null,
    dirWatchers: /* @__PURE__ */ new Map(),
    pendingTimers: /* @__PURE__ */ new Map()
  };
  walkDirectories(resolvedProjectPath, (dirPath) => {
    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        handleWatchEvent(handle, dirPath, eventType, filename);
      });
      handle.dirWatchers.set(path.resolve(dirPath), watcher);
    } catch {
    }
  });
  return handle;
}
function startProjectWatcher(projectPath) {
  const resolved = path.resolve(projectPath);
  const existing = watchersByProjectPath.get(resolved);
  if (existing) {
    existing.refCount++;
    return { success: true };
  }
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return { success: false, error: "Project path is not a directory" };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Project path not found" };
  }
  const handle = createProjectWatchHandle(resolved);
  watchersByProjectPath.set(resolved, handle);
  return { success: true };
}
function stopProjectWatcher(projectPath) {
  const resolved = path.resolve(projectPath);
  const handle = watchersByProjectPath.get(resolved);
  if (!handle) return { success: true };
  handle.refCount = Math.max(0, handle.refCount - 1);
  if (handle.refCount > 0) return { success: true };
  try {
    if (handle.rootWatcher) {
      try {
        handle.rootWatcher.close();
      } catch {
      }
      handle.rootWatcher = null;
    }
    for (const watcher of handle.dirWatchers.values()) {
      try {
        watcher.close();
      } catch {
      }
    }
    handle.dirWatchers.clear();
    for (const timer of handle.pendingTimers.values()) {
      clearTimeout(timer);
    }
    handle.pendingTimers.clear();
    watchersByProjectPath.delete(resolved);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to stop watcher" };
  }
}
const WORKSPACE_ROOT = path.resolve(
  process.env.COZEA_WORKSPACE_ROOT || process.env.APP_ROOT || process.cwd()
);
const MAX_OUTPUT_LENGTH$1 = 6e4;
const TRUNCATION_MESSAGE$1 = "\n...output truncated...\n";
const backgroundProcesses = /* @__PURE__ */ new Map();
function truncateOutput$1(output) {
  if (output.length <= MAX_OUTPUT_LENGTH$1) return output;
  const tailLength = Math.max(0, MAX_OUTPUT_LENGTH$1 - TRUNCATION_MESSAGE$1.length);
  return `${TRUNCATION_MESSAGE$1}${output.slice(-tailLength)}`;
}
function appendOutput(current, chunk) {
  return truncateOutput$1(current + chunk);
}
function resolveToolPath(inputPath, workingDir) {
  const resolved = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(workingDir, inputPath)
  );
  const relative = path.relative(workingDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside of the workspace");
  }
  return resolved;
}
async function runRipgrep(args, workingDir) {
  return new Promise((resolve, reject) => {
    const rg = node_child_process.spawn(ripgrep.rgPath, args, { cwd: workingDir });
    let stdout = "";
    let stderr = "";
    rg.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    rg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    rg.on("error", (err) => {
      reject(err);
    });
    rg.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `rg exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}
async function readFile(input, workingDir) {
  const filePath = resolveToolPath(input.filePath, workingDir);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const maxLines = 2e3;
  let offset = 1;
  let limit = totalLines;
  const hasRange = input.startLine !== void 0 || input.endLine !== void 0;
  if (hasRange) {
    const startLine2 = Math.max(1, input.startLine ?? 1);
    const endLine2 = Math.min(totalLines, input.endLine ?? totalLines);
    offset = Math.min(totalLines, startLine2);
    const adjustedEnd = Math.max(offset, endLine2);
    limit = Math.max(1, adjustedEnd - offset + 1);
  } else {
    offset = Math.max(1, input.offset ?? 1);
    limit = input.limit ? Math.max(1, input.limit) : totalLines;
  }
  const startIndex = Math.min(totalLines, offset) - 1;
  const boundedLimit = Math.min(limit, maxLines);
  const endIndex = Math.min(totalLines, startIndex + boundedLimit);
  const slice = lines.slice(startIndex, endIndex);
  const startLine = offset;
  const endLine = Math.min(totalLines, offset + boundedLimit - 1);
  return {
    filePath,
    content: slice.join("\n"),
    offset,
    limit: boundedLimit,
    startLine,
    endLine,
    totalLines,
    truncated: endIndex < totalLines || boundedLimit < limit
  };
}
async function listDir(input, workingDir) {
  const dirPath = resolveToolPath(input.path, workingDir);
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return {
    path: dirPath,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    }))
  };
}
async function findFiles(input, workingDir) {
  const pattern = input.query;
  const args = ["--files", "-g", pattern];
  const raw = await runRipgrep(args, workingDir);
  const results = raw.split(/\r?\n/).filter(Boolean);
  const max = input.maxResults ? Math.max(1, input.maxResults) : 20;
  return {
    query: pattern,
    results: results.slice(0, max),
    total: results.length,
    truncated: results.length > max
  };
}
async function grepSearch(input, workingDir) {
  const max = input.maxResults ? Math.max(1, input.maxResults) : 20;
  const args = ["--json"];
  if (input.includePattern) {
    args.push("-g", input.includePattern);
  }
  if (input.includeIgnoredFiles) {
    args.push("-uuu");
  }
  if (input.isRegexp === false) {
    args.push("-F");
  }
  args.push(input.query);
  const raw = await runRipgrep(args, workingDir);
  const matches = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "match") {
        const filePath = event.data.path.text;
        const lineNumber = event.data.line_number;
        const text = event.data.lines.text;
        matches.push({ filePath, line: lineNumber, text });
      }
    } catch {
    }
  }
  return {
    query: input.query,
    results: matches.slice(0, max),
    total: matches.length,
    truncated: matches.length > max
  };
}
async function createFile(input, workingDir, options) {
  const filePath = resolveToolPath(input.filePath, workingDir);
  if (fs.existsSync(filePath)) {
    throw new Error("File already exists");
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  markInternalFsChange(filePath);
  fs.writeFileSync(filePath, input.content ?? "", "utf-8");
  if (options?.notify) {
    notifyFileChanged(filePath, input.content ?? "", { origin: "agent" });
  }
  return { filePath };
}
async function createDirectory(input, workingDir) {
  const targetPath = input.dirPath ?? input.path;
  if (!targetPath) {
    throw new Error("dirPath is required");
  }
  const dirPath = resolveToolPath(targetPath, workingDir);
  fs.mkdirSync(dirPath, { recursive: true });
  return { dirPath };
}
function replaceStringInFile(input, workingDir, options) {
  const filePath = resolveToolPath(input.filePath, workingDir);
  const content = fs.readFileSync(filePath, "utf-8");
  const occurrences = content.split(input.oldString).length - 1;
  if (occurrences === 0) {
    throw new Error("Old string not found in file");
  }
  if (occurrences > 1) {
    throw new Error("Old string must match exactly one occurrence");
  }
  const updated = content.replace(input.oldString, input.newString);
  markInternalFsChange(filePath);
  fs.writeFileSync(filePath, updated, "utf-8");
  if (options?.notify) {
    notifyFileChanged(filePath, updated, { origin: "agent" });
  }
  return { filePath, replacements: 1 };
}
function multiReplaceString(input, workingDir, options) {
  const results = [];
  for (const replacement of input.replacements) {
    const filePath = resolveToolPath(replacement.filePath, workingDir);
    const content = fs.readFileSync(filePath, "utf-8");
    const occurrences = content.split(replacement.oldString).length - 1;
    if (occurrences === 0) {
      throw new Error(`Old string not found in file: ${replacement.filePath}`);
    }
    if (occurrences > 1) {
      throw new Error(`Old string must match exactly one occurrence in file: ${replacement.filePath}`);
    }
    const updated = content.replace(replacement.oldString, replacement.newString);
    markInternalFsChange(filePath);
    fs.writeFileSync(filePath, updated, "utf-8");
    if (options?.notify) {
      notifyFileChanged(filePath, updated, { origin: "agent" });
    }
    results.push({ filePath, replacements: 1 });
  }
  return { results };
}
async function runInTerminal(input, workingDir) {
  if (!input.command || typeof input.command !== "string") {
    throw new Error("command is required");
  }
  const timeoutMs = typeof input.timeout === "number" ? Math.max(0, input.timeout) : 0;
  const isBackground = Boolean(input.isBackground);
  const child = node_child_process.spawn(input.command, {
    cwd: workingDir,
    shell: true,
    env: process.env
  });
  if (isBackground) {
    const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id,
      command: input.command,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      process: child
    };
    child.stdout.on("data", (chunk) => {
      entry.stdout = appendOutput(entry.stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      entry.stderr = appendOutput(entry.stderr, chunk.toString());
    });
    child.on("close", (code) => {
      entry.exitCode = code;
      entry.endedAt = Date.now();
    });
    child.on("error", (err) => {
      entry.stderr = appendOutput(entry.stderr, `${err.message}
`);
      entry.exitCode = -1;
      entry.endedAt = Date.now();
    });
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!entry.endedAt) {
          entry.timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {
          }
        }
      }, timeoutMs);
    }
    backgroundProcesses.set(id, entry);
    return { id, pid: child.pid, command: input.command, isBackground: true };
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle;
    const finish = (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        command: input.command,
        stdout: truncateOutput$1(stdout),
        stderr: truncateOutput$1(stderr),
        exitCode: code,
        timedOut
      });
    };
    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk.toString());
    });
    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      stderr = appendOutput(stderr, `${err.message}
`);
      finish(-1);
    });
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
      }, timeoutMs);
    }
  });
}
async function getTerminalOutput(input) {
  if (!input.id || typeof input.id !== "string") {
    throw new Error("id is required");
  }
  const entry = backgroundProcesses.get(input.id);
  if (!entry) {
    throw new Error("Unknown terminal id");
  }
  return {
    id: entry.id,
    command: entry.command,
    stdout: entry.stdout,
    stderr: entry.stderr,
    exitCode: entry.exitCode ?? null,
    running: entry.endedAt === void 0,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt ?? null,
    timedOut: entry.timedOut ?? false
  };
}
async function runTool(request) {
  const workingDir = request.projectPath || WORKSPACE_ROOT;
  const shouldNotify = Boolean(request.projectPath);
  try {
    switch (request.name) {
      case "read_file":
        return { success: true, output: await readFile(request.input, workingDir) };
      case "list_dir":
        return { success: true, output: await listDir(request.input, workingDir) };
      case "file_search":
        return { success: true, output: await findFiles(request.input, workingDir) };
      case "grep_search":
        return { success: true, output: await grepSearch(request.input, workingDir) };
      case "create_file":
        return { success: true, output: await createFile(request.input, workingDir, { notify: shouldNotify }) };
      case "create_directory":
        return { success: true, output: await createDirectory(request.input, workingDir) };
      case "replace_string_in_file":
        return {
          success: true,
          output: replaceStringInFile(request.input, workingDir, { notify: shouldNotify })
        };
      case "multi_replace_string_in_file":
        return {
          success: true,
          output: multiReplaceString(request.input, workingDir, { notify: shouldNotify })
        };
      case "run_in_terminal":
        return { success: true, output: await runInTerminal(request.input, workingDir) };
      case "get_terminal_output":
        return { success: true, output: await getTerminalOutput(request.input) };
      case "apply_patch":
        return { success: false, error: "apply_patch is not yet enabled in this runtime" };
      default:
        return { success: false, error: `Unknown tool: ${request.name}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Tool failed" };
  }
}
const STYLE_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "overflow",
  "cursor",
  "zIndex",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textDecoration",
  "textTransform",
  "color",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "backgroundRepeat",
  "border",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "boxShadow",
  "opacity",
  "transform",
  "transition",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
  "flexWrap",
  "flexGrow",
  "flexShrink"
];
const BRIDGE_SCRIPT = `
(function() {
  // Prevent double initialization
  if (window.__COZEA_BRIDGE_LOADED__) return;
  window.__COZEA_BRIDGE_LOADED__ = true;

  let inspectorEnabled = false;
  let highlightOverlay = null;
  let selectedOverlay = null;
  let currentSelectedElement = null;
  let lastContextMenuTime = 0;

  // Create highlight overlay element
  function createOverlay(id, color) {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = \`
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      border: 2px solid \${color};
      background: \${color}22;
      transition: all 0.05s ease;
      display: none;
      box-sizing: border-box;
    \`;
    document.body.appendChild(overlay);
    return overlay;
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
      window.parent.postMessage(message, '*');
    } catch (e) {
      console.warn('[Bridge] Failed to post message:', e);
    }
  }

  // Handle mouse move during inspection
  function handleMouseMove(e) {
    if (!inspectorEnabled) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightOverlay || el === selectedOverlay || el === document.documentElement) return;

    const rect = el.getBoundingClientRect();
    positionOverlay(highlightOverlay, rect);

    postToParent({
      type: 'bridge:element-hover',
      payload: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || '',
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    });
  }

  // Handle click during inspection
  function handleClick(e) {
    if (!inspectorEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightOverlay || el === selectedOverlay || el === document.documentElement) return;

    currentSelectedElement = el;
    const rect = el.getBoundingClientRect();

    // Show selection overlay, hide hover
    positionOverlay(selectedOverlay, rect);
    if (highlightOverlay) highlightOverlay.style.display = 'none';

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
    if (!el || el === highlightOverlay || el === selectedOverlay || el === document.documentElement) return;

    currentSelectedElement = el;
    const rect = el.getBoundingClientRect();

    // Show selection overlay, hide hover
    positionOverlay(selectedOverlay, rect);
    if (highlightOverlay) highlightOverlay.style.display = 'none';

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
  async function captureScreenshot() {
    try {
      // Dynamically load html2canvas if not present
      if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load html2canvas'));
          document.head.appendChild(script);
        });
      }

      // Hide overlays during capture
      if (highlightOverlay) highlightOverlay.style.display = 'none';
      if (selectedOverlay) selectedOverlay.style.display = 'none';

      const canvas = await window.html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio || 1,
        logging: false,
        width: window.innerWidth,
        height: window.innerHeight,
      });

      const dataUrl = canvas.toDataURL('image/png');
      postToParent({
        type: 'bridge:screenshot-ready',
        payload: { dataUrl }
      });
    } catch (err) {
      postToParent({
        type: 'bridge:screenshot-ready',
        payload: { error: err.message || 'Screenshot capture failed' }
      });
    }
  }

  // Apply style update to selected element
  function applyStyleUpdate(styles) {
    if (!currentSelectedElement) {
      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: false, error: 'No element selected' }
      });
      return;
    }

    try {
      for (const [prop, value] of Object.entries(styles)) {
        currentSelectedElement.style[prop] = value;
      }

      // Update selection overlay position in case size changed
      const rect = currentSelectedElement.getBoundingClientRect();
      positionOverlay(selectedOverlay, rect);

      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: true }
      });
    } catch (err) {
      postToParent({
        type: 'bridge:style-update-ack',
        payload: { success: false, error: err.message }
      });
    }
  }

  // Clear selection
  function clearSelection() {
    currentSelectedElement = null;
    if (selectedOverlay) selectedOverlay.style.display = 'none';
    if (highlightOverlay) highlightOverlay.style.display = 'none';
  }

  // Listen for messages from parent
  window.addEventListener('message', (e) => {
    const { type, payload } = e.data || {};

    switch (type) {
      case 'host:enable-inspector':
        inspectorEnabled = true;
        if (!highlightOverlay) {
          highlightOverlay = createOverlay('cozea-highlight', '#3b82f6');
          selectedOverlay = createOverlay('cozea-selected', '#22c55e');
        }
        document.body.style.cursor = 'crosshair';
        break;

      case 'host:disable-inspector':
        inspectorEnabled = false;
        if (highlightOverlay) highlightOverlay.style.display = 'none';
        document.body.style.cursor = '';
        break;

      case 'host:request-screenshot':
        captureScreenshot();
        break;

      case 'host:update-style':
        if (payload && payload.styles) {
          applyStyleUpdate(payload.styles);
        }
        break;

      case 'host:update-text':
        if (payload && typeof payload.text === 'string' && currentSelectedElement) {
          currentSelectedElement.textContent = payload.text;

          // Update selection overlay position in case size changed
          const rect = currentSelectedElement.getBoundingClientRect();
          positionOverlay(selectedOverlay, rect);
        }
        break;

      case 'host:clear-selection':
        clearSelection();
        break;
    }
  });

  // Attach event listeners (capture phase for inspection)
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('contextmenu', handleContextMenu, true);

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

  // Signal bridge is ready
  postToParent({ type: 'bridge:ready' });
  console.log('[Cozea] Preview bridge initialized');
})();
`;
function resolvePathWithinDirectory(baseDir, inputPath) {
  if (!baseDir || typeof baseDir !== "string") {
    throw new Error("Base directory is required");
  }
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Path is required");
  }
  if (inputPath.includes("\0")) {
    throw new Error("Invalid path");
  }
  const resolved = path.resolve(baseDir, inputPath);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside of the project directory");
  }
  return resolved;
}
const KEYS_DIR_NAME = "integration-keys";
function getKeysDirectory() {
  const userDataPath = electron.app.getPath("userData");
  return path.join(userDataPath, KEYS_DIR_NAME);
}
function getKeyFilePath(keyId) {
  return path.join(getKeysDirectory(), `${keyId}.key`);
}
function ensureKeysDirectory() {
  const keysDir = getKeysDirectory();
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }
}
function isEncryptionAvailable() {
  return electron.safeStorage.isEncryptionAvailable();
}
function generateEncryptionKey() {
  const keyBytes = node_crypto.randomBytes(32);
  const keyData = keyBytes.toString("hex");
  const keyId = node_crypto.randomUUID();
  return { keyId, keyData };
}
function storeEncryptionKey(keyId, keyData) {
  try {
    if (!electron.safeStorage.isEncryptionAvailable()) {
      return {
        success: false,
        error: "Encryption is not available on this system. Please ensure your OS keychain is properly configured."
      };
    }
    if (!/^[0-9a-f]{64}$/i.test(keyData)) {
      return {
        success: false,
        error: "Invalid key format. Key must be a 64-character hex string."
      };
    }
    ensureKeysDirectory();
    const encryptedKey = electron.safeStorage.encryptString(keyData);
    const keyPath = getKeyFilePath(keyId);
    fs.writeFileSync(keyPath, encryptedKey);
    return { success: true };
  } catch (err) {
    console.error("Failed to store encryption key:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to store encryption key"
    };
  }
}
function getEncryptionKey(keyId) {
  try {
    const keyPath = getKeyFilePath(keyId);
    if (!fs.existsSync(keyPath)) {
      return {
        success: false,
        error: `Key not found: ${keyId}`
      };
    }
    if (!electron.safeStorage.isEncryptionAvailable()) {
      return {
        success: false,
        error: "Encryption is not available on this system."
      };
    }
    const encryptedKey = fs.readFileSync(keyPath);
    const keyData = electron.safeStorage.decryptString(encryptedKey);
    return { success: true, keyData };
  } catch (err) {
    console.error("Failed to retrieve encryption key:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to retrieve encryption key"
    };
  }
}
function deleteEncryptionKey(keyId) {
  try {
    const keyPath = getKeyFilePath(keyId);
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
    }
    return { success: true };
  } catch (err) {
    console.error("Failed to delete encryption key:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete encryption key"
    };
  }
}
function keyExists(keyId) {
  const keyPath = getKeyFilePath(keyId);
  return fs.existsSync(keyPath);
}
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function hexToBuffer(hex) {
  return Buffer.from(hex, "hex");
}
function bufferToHex(buffer) {
  return buffer.toString("hex");
}
function encryptCredentials(credentials, keyHex) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      return {
        success: false,
        error: "Invalid key format. Key must be a 64-character hex string (32 bytes)."
      };
    }
    const key = hexToBuffer(keyHex);
    const iv = node_crypto.randomBytes(IV_LENGTH);
    const cipher = node_crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });
    const plaintext = JSON.stringify(credentials);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    const encrypted = `${bufferToHex(iv)}:${bufferToHex(authTag)}:${bufferToHex(ciphertext)}`;
    return { success: true, encrypted };
  } catch (err) {
    console.error("Encryption failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Encryption failed"
    };
  }
}
function decryptCredentials$1(encrypted, keyHex) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      return {
        success: false,
        error: "Invalid key format. Key must be a 64-character hex string (32 bytes)."
      };
    }
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      return {
        success: false,
        error: "Invalid encrypted format. Expected iv:authTag:ciphertext"
      };
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    if (ivHex.length !== IV_LENGTH * 2) {
      return {
        success: false,
        error: `Invalid IV length. Expected ${IV_LENGTH * 2} hex chars, got ${ivHex.length}`
      };
    }
    if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
      return {
        success: false,
        error: `Invalid auth tag length. Expected ${AUTH_TAG_LENGTH * 2} hex chars, got ${authTagHex.length}`
      };
    }
    const key = hexToBuffer(keyHex);
    const iv = hexToBuffer(ivHex);
    const authTag = hexToBuffer(authTagHex);
    const ciphertext = hexToBuffer(ciphertextHex);
    const decipher = node_crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    const credentials = JSON.parse(plaintext.toString("utf8"));
    return { success: true, credentials };
  } catch (err) {
    console.error("Decryption failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Decryption failed. Key may be incorrect or data corrupted."
    };
  }
}
const pendingFlows = /* @__PURE__ */ new Map();
const OAUTH_CONFIGS = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "workflow"],
    pkce: false
  },
  vercel: {
    authUrl: "https://vercel.com/oauth/authorize",
    tokenUrl: "https://api.vercel.com/v2/oauth/access_token",
    scopes: [],
    pkce: true
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read"],
    pkce: false
  }
};
function generateCodeVerifier() {
  return node_crypto.randomBytes(32).toString("base64url");
}
function generateCodeChallenge(verifier) {
  return node_crypto.createHash("sha256").update(verifier).digest("base64url");
}
async function startOAuthFlow(provider, orgId, redirectUri = "cozea://oauth/callback") {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    return { success: false, error: `Unknown OAuth provider: ${provider}` };
  }
  const clientIdEnvVar = `${provider.toUpperCase()}_CLIENT_ID`;
  const clientId = process.env[clientIdEnvVar];
  if (!clientId) {
    return { success: false, error: `OAuth not configured: ${clientIdEnvVar} environment variable not set` };
  }
  const state = node_crypto.randomUUID();
  let codeVerifier;
  let codeChallenge;
  if (config.pkce) {
    codeVerifier = generateCodeVerifier();
    codeChallenge = generateCodeChallenge(codeVerifier);
  }
  pendingFlows.set(state, {
    provider,
    orgId,
    state,
    codeVerifier,
    createdAt: Date.now()
  });
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_type", "code");
  if (config.scopes.length > 0) {
    authUrl.searchParams.set("scope", config.scopes.join(" "));
  }
  if (config.pkce && codeChallenge) {
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
  }
  await electron.shell.openExternal(authUrl.toString());
  const now = Date.now();
  for (const [flowState, flow] of pendingFlows.entries()) {
    if (now - flow.createdAt > 10 * 60 * 1e3) {
      pendingFlows.delete(flowState);
    }
  }
  return { success: true };
}
async function handleOAuthCallback(callbackUrl, redirectUri = "cozea://oauth/callback") {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (error) {
    return {
      success: false,
      provider: "unknown",
      error: errorDescription || error
    };
  }
  if (!state) {
    return { success: false, provider: "unknown", error: "Missing state parameter" };
  }
  const pendingFlow = pendingFlows.get(state);
  if (!pendingFlow) {
    return { success: false, provider: "unknown", error: "Invalid or expired state" };
  }
  pendingFlows.delete(state);
  if (!code) {
    return { success: false, provider: pendingFlow.provider, error: "Missing authorization code" };
  }
  const config = OAUTH_CONFIGS[pendingFlow.provider];
  if (!config) {
    return { success: false, provider: pendingFlow.provider, error: "Unknown provider" };
  }
  const clientId = process.env[`${pendingFlow.provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${pendingFlow.provider.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId) {
    return { success: false, provider: pendingFlow.provider, error: "Client ID not configured" };
  }
  try {
    const tokenResponse = await exchangeCodeForTokens({
      provider: pendingFlow.provider,
      code,
      clientId,
      clientSecret,
      codeVerifier: pendingFlow.codeVerifier,
      redirectUri,
      tokenUrl: config.tokenUrl
    });
    if (!tokenResponse.success) {
      return {
        success: false,
        provider: pendingFlow.provider,
        error: tokenResponse.error
      };
    }
    const userInfo = await fetchUserInfo(pendingFlow.provider, tokenResponse.accessToken);
    return {
      success: true,
      provider: pendingFlow.provider,
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      tokenExpiresAt: tokenResponse.expiresAt,
      externalId: userInfo?.id,
      externalAccountName: userInfo?.name || userInfo?.login || userInfo?.email,
      scopes: config.scopes
    };
  } catch (err) {
    console.error("OAuth callback error:", err);
    return {
      success: false,
      provider: pendingFlow.provider,
      error: err instanceof Error ? err.message : "Token exchange failed"
    };
  }
}
async function exchangeCodeForTokens(params) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri
  });
  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }
  if (params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (params.provider === "github") {
    headers["Accept"] = "application/json";
  }
  const response = await fetch(params.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("Token exchange failed:", text);
    return { success: false, error: `Token exchange failed: ${response.status}` };
  }
  const data = await response.json();
  if (data.error) {
    return { success: false, error: data.error_description || data.error };
  }
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = data.expires_in;
  if (!accessToken) {
    return { success: false, error: "No access token in response" };
  }
  return {
    success: true,
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1e3 : void 0
  };
}
async function fetchUserInfo(provider, accessToken) {
  try {
    let url;
    const headers = {
      Authorization: `Bearer ${accessToken}`
    };
    switch (provider) {
      case "github":
        url = "https://api.github.com/user";
        headers["Accept"] = "application/vnd.github+json";
        break;
      case "vercel":
        url = "https://api.vercel.com/v2/user";
        break;
      case "slack":
        url = "https://slack.com/api/auth.test";
        break;
      default:
        return null;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`Failed to fetch user info: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (provider === "slack") {
      return {
        id: data.user_id,
        name: data.user
      };
    }
    return {
      id: data.id?.toString(),
      name: data.name || data.username,
      login: data.login,
      email: data.email
    };
  } catch (err) {
    console.error("Failed to fetch user info:", err);
    return null;
  }
}
const INTEGRATION_TOOLS = [
  // GitHub
  {
    provider: "github",
    name: "github_cli",
    displayName: "GitHub CLI",
    command: "gh",
    description: "Run GitHub CLI commands (gh)",
    envMapping: {
      accessToken: "GH_TOKEN"
    }
  },
  // Supabase
  {
    provider: "supabase",
    name: "supabase_cli",
    displayName: "Supabase CLI",
    command: "supabase",
    description: "Run Supabase CLI commands",
    envMapping: {
      accessToken: "SUPABASE_ACCESS_TOKEN",
      projectUrl: "SUPABASE_URL",
      anonKey: "SUPABASE_ANON_KEY"
    }
  },
  // Vercel
  {
    provider: "vercel",
    name: "vercel_cli",
    displayName: "Vercel CLI",
    command: "vercel",
    description: "Run Vercel CLI commands",
    envMapping: {
      accessToken: "VERCEL_TOKEN"
    }
  },
  // Firebase
  {
    provider: "firebase",
    name: "firebase_cli",
    displayName: "Firebase CLI",
    command: "firebase",
    description: "Run Firebase CLI commands",
    envMapping: {
      // Firebase uses service account JSON, needs special handling
      serviceAccountKey: "GOOGLE_APPLICATION_CREDENTIALS_JSON"
    }
  },
  // Netlify
  {
    provider: "netlify",
    name: "netlify_cli",
    displayName: "Netlify CLI",
    command: "netlify",
    description: "Run Netlify CLI commands",
    envMapping: {
      accessToken: "NETLIFY_AUTH_TOKEN"
    }
  },
  // Railway
  {
    provider: "railway",
    name: "railway_cli",
    displayName: "Railway CLI",
    command: "railway",
    description: "Run Railway CLI commands",
    envMapping: {
      apiToken: "RAILWAY_TOKEN"
    }
  },
  // Stripe
  {
    provider: "stripe",
    name: "stripe_cli",
    displayName: "Stripe CLI",
    command: "stripe",
    description: "Run Stripe CLI commands",
    envMapping: {
      secretKey: "STRIPE_API_KEY"
    }
  },
  // Fly.io
  {
    provider: "fly",
    name: "fly_cli",
    displayName: "Fly CLI",
    command: "fly",
    description: "Run Fly.io CLI commands (flyctl)",
    envMapping: {
      accessToken: "FLY_ACCESS_TOKEN"
    }
  },
  // PlanetScale
  {
    provider: "planetscale",
    name: "planetscale_cli",
    displayName: "PlanetScale CLI",
    command: "pscale",
    description: "Run PlanetScale CLI commands",
    envMapping: {
      serviceToken: "PLANETSCALE_SERVICE_TOKEN",
      serviceTokenId: "PLANETSCALE_SERVICE_TOKEN_ID",
      orgName: "PLANETSCALE_ORG"
    }
  },
  // Neon
  {
    provider: "neon",
    name: "neon_cli",
    displayName: "Neon CLI",
    command: "neon",
    description: "Run Neon CLI commands",
    envMapping: {
      apiKey: "NEON_API_KEY"
    }
  },
  // AWS (for S3 and other services)
  {
    provider: "aws",
    name: "aws_cli",
    displayName: "AWS CLI",
    command: "aws",
    description: "Run AWS CLI commands",
    envMapping: {
      accessKeyId: "AWS_ACCESS_KEY_ID",
      secretAccessKey: "AWS_SECRET_ACCESS_KEY",
      region: "AWS_DEFAULT_REGION"
    }
  },
  // Cloudflare
  {
    provider: "cloudflare",
    name: "wrangler_cli",
    displayName: "Wrangler CLI",
    command: "wrangler",
    description: "Run Cloudflare Wrangler CLI commands",
    envMapping: {
      apiToken: "CLOUDFLARE_API_TOKEN",
      accountId: "CLOUDFLARE_ACCOUNT_ID"
    }
  },
  // Linear
  {
    provider: "linear",
    name: "linear_api",
    displayName: "Linear API",
    command: "curl",
    // Linear doesn't have a CLI, so we use curl for API calls
    description: "Make Linear API calls",
    envMapping: {
      apiKey: "LINEAR_API_KEY"
    }
  },
  // Work OS - API-based tools (use curl for REST API calls)
  // Notion
  {
    provider: "notion",
    name: "notion_api",
    displayName: "Notion API",
    command: "curl",
    description: "Make Notion API calls",
    envMapping: {
      apiKey: "NOTION_API_KEY"
    }
  },
  // Airtable
  {
    provider: "airtable",
    name: "airtable_api",
    displayName: "Airtable API",
    command: "curl",
    description: "Make Airtable API calls",
    envMapping: {
      apiKey: "AIRTABLE_API_KEY",
      baseId: "AIRTABLE_BASE_ID"
    }
  },
  // Monday.com
  {
    provider: "monday",
    name: "monday_api",
    displayName: "Monday.com API",
    command: "curl",
    description: "Make Monday.com API calls",
    envMapping: {
      apiKey: "MONDAY_API_KEY"
    }
  },
  // Asana
  {
    provider: "asana",
    name: "asana_api",
    displayName: "Asana API",
    command: "curl",
    description: "Make Asana API calls",
    envMapping: {
      accessToken: "ASANA_ACCESS_TOKEN"
    }
  },
  // ClickUp
  {
    provider: "clickup",
    name: "clickup_api",
    displayName: "ClickUp API",
    command: "curl",
    description: "Make ClickUp API calls",
    envMapping: {
      apiKey: "CLICKUP_API_KEY"
    }
  },
  // Coda
  {
    provider: "coda",
    name: "coda_api",
    displayName: "Coda API",
    command: "curl",
    description: "Make Coda API calls",
    envMapping: {
      apiKey: "CODA_API_KEY"
    }
  }
];
function isIntegrationTool(toolName) {
  return INTEGRATION_TOOLS.some((t) => t.name === toolName);
}
function getIntegrationToolDefinition(toolName) {
  return INTEGRATION_TOOLS.find((t) => t.name === toolName);
}
function buildEnvFromCredentials(credentials, envMapping) {
  const env = {};
  for (const [credField, envVar] of Object.entries(envMapping)) {
    const value = credentials[credField];
    if (value !== void 0 && value !== null) {
      env[envVar] = value;
    }
  }
  return env;
}
async function decryptIntegrationCredentials(encryptedCredentials, keyId) {
  const keyResult = getEncryptionKey(keyId);
  if (!keyResult.success || !keyResult.keyData) {
    return { success: false, error: keyResult.error || "Encryption key not found in keychain" };
  }
  const decryptResult = decryptCredentials$1(encryptedCredentials, keyResult.keyData);
  if (!decryptResult.success || !decryptResult.credentials) {
    return { success: false, error: decryptResult.error || "Failed to decrypt credentials" };
  }
  return { success: true, credentials: decryptResult.credentials };
}
const MAX_OUTPUT_LENGTH = 6e4;
const TRUNCATION_MESSAGE = "\n...output truncated...\n";
function truncateOutput(output) {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  const tailLength = Math.max(0, MAX_OUTPUT_LENGTH - TRUNCATION_MESSAGE.length);
  return `${TRUNCATION_MESSAGE}${output.slice(-tailLength)}`;
}
async function executeIntegrationTool(request) {
  const toolDef = getIntegrationToolDefinition(request.toolName);
  if (!toolDef) {
    return { success: false, error: `Unknown integration tool: ${request.toolName}` };
  }
  const credEnv = buildEnvFromCredentials(request.credentials, toolDef.envMapping);
  const env = {
    ...process.env,
    ...credEnv
  };
  if (toolDef.provider === "firebase" && credEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const fs2 = await import("node:fs");
    const path2 = await import("node:path");
    const os = await import("node:os");
    const tempDir = os.tmpdir();
    const credPath = path2.join(tempDir, `firebase-sa-${Date.now()}.json`);
    try {
      fs2.writeFileSync(credPath, credEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON, "utf-8");
      env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
      delete env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      setTimeout(() => {
        try {
          fs2.unlinkSync(credPath);
        } catch {
        }
      }, 6e4);
    } catch (err) {
      return {
        success: false,
        error: `Failed to write Firebase credentials: ${err instanceof Error ? err.message : "Unknown error"}`
      };
    }
  }
  const command = toolDef.command;
  const args = request.args;
  const timeoutMs = request.timeout || 12e4;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle;
    const spawnOptions = {
      cwd: request.workingDir,
      env,
      shell: true
    };
    const child = node_child_process.spawn(command, args, spawnOptions);
    const finish = (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        success: code === 0,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode: code,
        timedOut
      });
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      stderr += `Error: ${err.message}
`;
      finish(-1);
    });
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
      }, timeoutMs);
    }
  });
}
async function runIntegrationTool(params) {
  const decryptResult = await decryptIntegrationCredentials(params.encryptedCredentials, params.keyId);
  if (!decryptResult.success || !decryptResult.credentials) {
    return { success: false, error: decryptResult.error || "Failed to decrypt credentials" };
  }
  return executeIntegrationTool({
    toolName: params.toolName,
    args: params.args,
    workingDir: params.workingDir,
    credentials: decryptResult.credentials,
    timeout: params.timeout
  });
}
function base64UrlEncode(value) {
  const base64 = (typeof value === "string" ? Buffer.from(value) : value).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decryptCredentials(encryptedCredentials, keyId) {
  const keyResult = getEncryptionKey(keyId);
  if (!keyResult.success || !keyResult.keyData) {
    throw new Error(keyResult.error || "Failed to retrieve encryption key");
  }
  const decryptResult = decryptCredentials$1(encryptedCredentials, keyResult.keyData);
  if (!decryptResult.success || !decryptResult.credentials) {
    throw new Error(decryptResult.error || "Failed to decrypt credentials");
  }
  return decryptResult.credentials;
}
function coerceString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
function getSupabaseCredentials(raw) {
  const url = coerceString(raw.url, "Supabase url");
  const anonKey = coerceString(raw.anonKey, "Supabase anonKey");
  return { url, anonKey };
}
function getFirebaseCredentials(raw) {
  const projectId = coerceString(raw.projectId, "Firebase projectId");
  const clientEmail = coerceString(raw.clientEmail, "Firebase clientEmail");
  const privateKey = coerceString(raw.privateKey, "Firebase privateKey");
  return { projectId, clientEmail, privateKey };
}
async function supabaseSelect(options) {
  const limit = typeof options.limit === "number" ? Math.max(1, Math.min(200, options.limit)) : 50;
  const offset = typeof options.offset === "number" ? Math.max(0, options.offset) : 0;
  const select = options.select?.trim() ? options.select.trim() : "*";
  const creds = options.credentials ?? (options.encryptedCredentials && options.keyId ? getSupabaseCredentials(decryptCredentials(options.encryptedCredentials, options.keyId)) : null);
  if (!creds) {
    throw new Error("Missing Supabase credentials (connect Supabase integration or set env vars)");
  }
  const baseUrl = new URL(creds.url);
  const endpoint = new URL(`${baseUrl.origin}/rest/v1/${encodeURIComponent(options.table)}`);
  endpoint.searchParams.set("select", select);
  endpoint.searchParams.set("limit", String(limit));
  if (offset) endpoint.searchParams.set("offset", String(offset));
  if (options.orderBy?.trim()) {
    endpoint.searchParams.set("order", `${options.orderBy}.${options.orderAscending === false ? "desc" : "asc"}`);
  }
  const res = await fetch(endpoint.toString(), {
    headers: {
      apikey: creds.anonKey,
      authorization: `Bearer ${creds.anonKey}`,
      accept: "application/json"
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase request failed (${res.status}): ${text || res.statusText}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected Supabase response (expected an array)");
  }
  return { rows };
}
const googleTokenCache = /* @__PURE__ */ new Map();
async function getGoogleAccessToken(creds) {
  const cacheKey = `${creds.clientEmail}|${creds.projectId}`;
  const cached = googleTokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAtMs - now > 6e4) {
    return cached.token;
  }
  const iat = Math.floor(now / 1e3);
  const exp = iat + 60 * 60;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: creds.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = node_crypto.createSign("RSA-SHA256").update(signingInput).sign(creds.privateKey);
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Google token request failed (${res.status}): ${text || res.statusText}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Google token response was not valid JSON");
  }
  const token = json.access_token;
  const expiresIn = json.expires_in;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Google token response missing access_token");
  }
  const expiresAtMs = now + (typeof expiresIn === "number" ? expiresIn * 1e3 : 55 * 60 * 1e3);
  googleTokenCache.set(cacheKey, { token, expiresAtMs });
  return token;
}
function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("doubleValue" in value) return value.doubleValue;
  if ("integerValue" in value) {
    const asNumber = Number(value.integerValue);
    if (Number.isSafeInteger(asNumber)) return asNumber;
    return value.integerValue;
  }
  if ("arrayValue" in value) {
    const values = value.arrayValue.values ?? [];
    return values.map((v) => decodeFirestoreValue(v));
  }
  if ("mapValue" in value) {
    const fields = value.mapValue.fields ?? {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v);
    return out;
  }
  return null;
}
function decodeFirestoreDocument(doc) {
  const name = typeof doc.name === "string" ? doc.name : "";
  const parts = name.split("/").filter(Boolean);
  const id = parts.length ? parts[parts.length - 1] : "unknown";
  const rawFields = doc.fields ?? {};
  const fields = {};
  for (const [k, v] of Object.entries(rawFields)) fields[k] = decodeFirestoreValue(v);
  return {
    id,
    path: name,
    createTime: typeof doc.createTime === "string" ? doc.createTime : void 0,
    updateTime: typeof doc.updateTime === "string" ? doc.updateTime : void 0,
    fields
  };
}
async function firestoreListDocuments(options) {
  const raw = decryptCredentials(options.encryptedCredentials, options.keyId);
  const creds = getFirebaseCredentials(raw);
  const token = await getGoogleAccessToken(creds);
  const pageSize = typeof options.pageSize === "number" ? Math.max(1, Math.min(200, options.pageSize)) : 50;
  const endpoint = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/databases/(default)/documents/${encodeURIComponent(options.collection)}`
  );
  endpoint.searchParams.set("pageSize", String(pageSize));
  if (options.pageToken) endpoint.searchParams.set("pageToken", options.pageToken);
  const res = await fetch(endpoint.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Firestore request failed (${res.status}): ${text || res.statusText}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Firestore response was not valid JSON");
  }
  const documentsRaw = json.documents;
  const nextPageToken = json.nextPageToken;
  const documents = Array.isArray(documentsRaw) ? documentsRaw.filter((d) => !!d && typeof d === "object").map((d) => decodeFirestoreDocument(d)) : [];
  return {
    documents,
    nextPageToken: typeof nextPageToken === "string" ? nextPageToken : void 0
  };
}
let xxhasher = null;
const devServerProcesses = /* @__PURE__ */ new Map();
const terminals = /* @__PURE__ */ new Map();
const projectTerminals = /* @__PURE__ */ new Map();
function detectTerminalProfiles() {
  const profiles = [];
  if (process.platform !== "win32") {
    if (fs.existsSync("/bin/zsh")) {
      profiles.push({ id: "zsh", name: "zsh", path: "/bin/zsh", icon: "terminal" });
    }
    if (fs.existsSync("/bin/bash")) {
      profiles.push({ id: "bash", name: "bash", path: "/bin/bash", icon: "terminal" });
    }
    if (fs.existsSync("/bin/sh")) {
      profiles.push({ id: "sh", name: "sh", path: "/bin/sh", icon: "terminal" });
    }
  }
  if (process.platform === "win32") {
    profiles.push({ id: "powershell", name: "PowerShell", path: "powershell.exe", icon: "terminal-powershell" });
    profiles.push({ id: "cmd", name: "Command Prompt", path: "cmd.exe", icon: "terminal-cmd" });
  }
  profiles.push({ id: "node", name: "Node.js", path: "node", icon: "symbol-event" });
  return profiles;
}
function getTerminalProfile(profileId) {
  const profiles = detectTerminalProfiles();
  if (profileId) {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) return profile;
  }
  return profiles[0] || { id: "sh", name: "sh", path: "/bin/sh", icon: "terminal" };
}
const execAsync = node_util.promisify(node_child_process.exec);
const __dirname$1 = path.dirname(node_url.fileURLToPath(require("url").pathToFileURL(__filename).href));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"] || process.env["ELECTRON_RENDERER_URL"];
const isProductionBuild = !VITE_DEV_SERVER_URL;
const MAIN_DIST = path.join(process.env.APP_ROOT, "out/main");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "out/renderer");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || "https://crosscode-auth-gateway-production.up.railway.app";
const PROTOCOL = "cozea";
let _sessionPath = null;
let _settingsPath = null;
let _defaultSettings = null;
function getSessionPath() {
  if (!_sessionPath) _sessionPath = path.join(electron.app.getPath("userData"), "session.enc");
  return _sessionPath;
}
function getSettingsPath() {
  if (!_settingsPath) _settingsPath = path.join(electron.app.getPath("userData"), "settings.json");
  return _settingsPath;
}
function getDefaultSettings() {
  if (!_defaultSettings) {
    _defaultSettings = {
      projectsDirectory: path.join(electron.app.getPath("home"), "Developer", "Cozea")
    };
  }
  return _defaultSettings;
}
function loadSettings() {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const data = fs.readFileSync(getSettingsPath(), "utf-8");
      return { ...getDefaultSettings(), ...JSON.parse(data) };
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
  return getDefaultSettings();
}
function saveSettings(settings) {
  try {
    const current = loadSettings();
    const updated = { ...current, ...settings };
    fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}
let win;
function saveSession(session) {
  const jsonData = JSON.stringify(session);
  if (electron.safeStorage.isEncryptionAvailable()) {
    const encryptedData = electron.safeStorage.encryptString(jsonData);
    fs.writeFileSync(getSessionPath(), encryptedData);
  } else if (isProductionBuild) {
    electron.dialog.showErrorBox(
      "Security Error",
      "Session encryption is not available on this system. Please ensure your operating system keychain is properly configured."
    );
    throw new Error("Session encryption required in production");
  } else {
    console.warn("safeStorage not available, storing session unencrypted (dev mode only)");
    fs.writeFileSync(getSessionPath(), jsonData);
  }
}
function loadSession() {
  try {
    if (!fs.existsSync(getSessionPath())) {
      return null;
    }
    const fileData = fs.readFileSync(getSessionPath());
    if (electron.safeStorage.isEncryptionAvailable()) {
      try {
        const decryptedData = electron.safeStorage.decryptString(fileData);
        return JSON.parse(decryptedData);
      } catch {
        const plainData = fileData.toString("utf-8");
        return JSON.parse(plainData);
      }
    } else {
      const data = fileData.toString("utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to load session:", err);
  }
  return null;
}
function clearSession() {
  try {
    if (fs.existsSync(getSessionPath())) {
      fs.unlinkSync(getSessionPath());
    }
    const oldSessionPath = getSessionPath().replace(".enc", ".json");
    if (fs.existsSync(oldSessionPath)) {
      fs.unlinkSync(oldSessionPath);
    }
  } catch (err) {
    console.error("Failed to clear session:", err);
  }
}
function handleBillingCallback(url) {
  const urlObj = new URL(url);
  const urlPath = urlObj.pathname;
  const type = urlObj.searchParams.get("type");
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const isSuccess = urlPath === "/success" || urlPath === "//success";
    const isCanceled = urlPath === "/canceled" || urlPath === "//canceled";
    let queryString = "";
    if (isSuccess) {
      queryString = `?success=${type || "true"}`;
    } else if (isCanceled) {
      queryString = "?canceled=true";
    }
    if (queryString) {
      if (VITE_DEV_SERVER_URL) {
        win.loadURL(`${VITE_DEV_SERVER_URL}/workspace/billing${queryString}`);
      } else {
        win.loadFile(path.join(RENDERER_DIST, "index.html"));
        win.webContents.once("did-finish-load", () => {
          win?.webContents.send("navigate", `/workspace/billing${queryString}`);
        });
      }
    }
  }
}
async function handleAuthCallback(url) {
  const urlObj = new URL(url);
  const token = urlObj.searchParams.get("token");
  if (!token) {
    console.error("No token in callback URL");
    win?.webContents.send("auth:error", "No token received");
    return;
  }
  try {
    const response = await fetch(`${AUTH_SERVER_URL}/auth/desktop/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if (!response.ok) {
      throw new Error("Token exchange failed");
    }
    const session = await response.json();
    saveSession(session);
    win?.webContents.send("auth:success", session);
  } catch (err) {
    console.error("Auth callback error:", err);
    win?.webContents.send("auth:error", "Authentication failed");
  }
}
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    electron.app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  electron.app.setAsDefaultProtocolClient(PROTOCOL);
}
electron.app.on("open-url", async (event, url) => {
  event.preventDefault();
  if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
    handleAuthCallback(url);
  } else if (url.startsWith(`${PROTOCOL}://billing/`)) {
    handleBillingCallback(url);
  } else if (url.startsWith(`${PROTOCOL}://oauth/callback`)) {
    try {
      const result = await handleOAuthCallback(url);
      if (result.success) {
        win?.webContents.send("integrations:oauthSuccess", result);
      } else {
        win?.webContents.send("integrations:oauthError", { provider: result.provider, error: result.error || "OAuth failed" });
      }
    } catch (err) {
      console.error("[OAuth] Callback handling error:", err);
      win?.webContents.send("integrations:oauthError", {
        provider: "unknown",
        error: err instanceof Error ? err.message : "OAuth callback failed"
      });
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }
});
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, commandLine) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
        handleAuthCallback(url);
      } else if (url.startsWith(`${PROTOCOL}://billing/`)) {
        handleBillingCallback(url);
      } else if (url.startsWith(`${PROTOCOL}://oauth/callback`)) {
        handleOAuthCallback(url).then((result) => {
          if (result.success) {
            win?.webContents.send("integrations:oauthSuccess", result);
          } else {
            win?.webContents.send("integrations:oauthError", { provider: result.provider, error: result.error || "OAuth failed" });
          }
        }).catch((err) => {
          console.error("[OAuth] Callback handling error:", err);
          win?.webContents.send("integrations:oauthError", {
            provider: "unknown",
            error: err instanceof Error ? err.message : "OAuth callback failed"
          });
        });
      }
    }
  });
}
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: "#000000",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 10 }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
electron.ipcMain.handle("auth:login", async () => {
  const loginUrl = `${AUTH_SERVER_URL}/auth/login?client=desktop`;
  await electron.shell.openExternal(loginUrl);
  return { success: true };
});
electron.ipcMain.handle("auth:logout", async () => {
  clearSession();
  try {
    await fetch(`${AUTH_SERVER_URL}/auth/logout`, { method: "POST" });
  } catch {
  }
  return { success: true };
});
electron.ipcMain.handle("auth:getSession", () => {
  return loadSession();
});
electron.ipcMain.handle("auth:updateOrganizations", (_event, organizations) => {
  const session = loadSession();
  if (!session) {
    return { success: false, error: "No session found" };
  }
  const updatedSession = {
    ...session,
    organizations
  };
  saveSession(updatedSession);
  return { success: true };
});
electron.ipcMain.handle("auth:refresh", async () => {
  const session = loadSession();
  if (!session?.refreshToken) {
    return null;
  }
  try {
    const response = await fetch(`${AUTH_SERVER_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!response.ok) {
      clearSession();
      return null;
    }
    const data = await response.json();
    const newSession = {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    };
    saveSession(newSession);
    return newSession;
  } catch {
    clearSession();
    return null;
  }
});
electron.ipcMain.handle("integrations:isEncryptionAvailable", () => {
  return isEncryptionAvailable();
});
electron.ipcMain.handle("integrations:generateKey", () => {
  try {
    const { keyId, keyData } = generateEncryptionKey();
    return { success: true, keyId, keyData };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to generate key" };
  }
});
electron.ipcMain.handle("integrations:storeKey", (_event, options) => {
  return storeEncryptionKey(options.keyId, options.keyData);
});
electron.ipcMain.handle("integrations:getKey", (_event, options) => {
  const result = getEncryptionKey(options.keyId);
  if (result.success) {
    return { success: true, keyId: options.keyId, keyData: result.keyData };
  }
  return result;
});
electron.ipcMain.handle("integrations:deleteKey", (_event, options) => {
  return deleteEncryptionKey(options.keyId);
});
electron.ipcMain.handle("integrations:keyExists", (_event, options) => {
  return keyExists(options.keyId);
});
electron.ipcMain.handle("integrations:encrypt", async (_event, options) => {
  const keyResult = getEncryptionKey(options.keyId);
  if (!keyResult.success || !keyResult.keyData) {
    return { success: false, error: keyResult.error || "Failed to retrieve encryption key" };
  }
  return encryptCredentials(options.credentials, keyResult.keyData);
});
electron.ipcMain.handle("integrations:decrypt", async (_event, options) => {
  const keyResult = getEncryptionKey(options.keyId);
  if (!keyResult.success || !keyResult.keyData) {
    return { success: false, error: keyResult.error || "Failed to retrieve encryption key" };
  }
  return decryptCredentials$1(options.encrypted, keyResult.keyData);
});
electron.ipcMain.handle("integrations:startOAuth", async (_event, options) => {
  return startOAuthFlow(options.provider, options.orgId);
});
electron.ipcMain.handle("integrations:runTool", async (_event, options) => {
  return runIntegrationTool(options);
});
electron.ipcMain.handle("integrations:isToolAvailable", (_event, options) => {
  return isIntegrationTool(options.toolName);
});
electron.ipcMain.handle("integrations:getToolDefinition", (_event, options) => {
  const def = getIntegrationToolDefinition(options.toolName);
  if (!def) return null;
  return {
    provider: def.provider,
    name: def.name,
    displayName: def.displayName,
    command: def.command,
    description: def.description
  };
});
electron.ipcMain.handle("integrations:listTools", () => {
  return INTEGRATION_TOOLS.map((t) => ({
    provider: t.provider,
    name: t.name,
    displayName: t.displayName,
    command: t.command,
    description: t.description
  }));
});
electron.ipcMain.handle("db:supabase:select", async (_event, options) => {
  try {
    const { rows } = await supabaseSelect(options);
    return { success: true, rows };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Supabase query failed" };
  }
});
electron.ipcMain.handle("db:firestore:listDocuments", async (_event, options) => {
  try {
    const { documents, nextPageToken } = await firestoreListDocuments(options);
    return { success: true, documents, nextPageToken };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Firestore query failed" };
  }
});
electron.ipcMain.handle("tools:run", async (_event, request) => {
  return runTool(request);
});
electron.ipcMain.handle("shell:openExternal", async (_event, url) => {
  await electron.shell.openExternal(url);
  return { success: true };
});
electron.ipcMain.handle("window:isFullScreen", () => {
  return win?.isFullScreen() ?? false;
});
function isAllowedPreviewUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}
async function findFrameByUrl(targetUrl, options) {
  const attempts = 15;
  const delayMs = 50;
  if (!win) return null;
  let targetOrigin = null;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    targetOrigin = null;
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const frames = win.webContents.mainFrame.frames.filter((f) => f !== win?.webContents.mainFrame);
    const exact = frames.find((f) => f.url === targetUrl);
    if (exact) return exact;
    if (targetOrigin) {
      const sameOrigin = frames.find((f) => {
        try {
          return new URL(f.url).origin === targetOrigin;
        } catch {
          return false;
        }
      });
      if (sameOrigin) return sameOrigin;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}
electron.ipcMain.handle(
  "preview:injectBridge",
  async (_event, { url }) => {
    if (!win) return { success: false, error: "No window available" };
    if (!url || typeof url !== "string") return { success: false, error: "Missing url" };
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: "Invalid url" };
    }
    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: "Only localhost preview URLs are supported" };
    }
    try {
      const mainUrl = win.webContents.getURL();
      const mainOrigin = new URL(mainUrl).origin;
      if (mainOrigin === parsedUrl.origin) {
        return { success: false, error: "Refusing to inject into main frame origin" };
      }
    } catch {
    }
    const frame = await findFrameByUrl(url);
    if (!frame) {
      return { success: false, error: "Preview frame not found" };
    }
    try {
      await frame.executeJavaScript(BRIDGE_SCRIPT);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to inject preview bridge";
      return { success: false, error: message };
    }
  }
);
electron.ipcMain.handle(
  "preview:captureScreenshot",
  async (_event, { url, width = 1280, height = 800 }) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }
    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: "Only localhost URLs are supported" };
    }
    const captureWindow = new electron.BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true
      }
    });
    try {
      const loadTimeout = 3e4;
      const loadPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Page load timeout"));
        }, loadTimeout);
        captureWindow.webContents.once("did-finish-load", () => {
          clearTimeout(timer);
          resolve();
        });
        captureWindow.webContents.once("did-fail-load", (_event2, errorCode, errorDescription) => {
          clearTimeout(timer);
          reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`));
        });
      });
      await captureWindow.loadURL(url);
      await loadPromise;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const image = await captureWindow.webContents.capturePage();
      const base64 = image.toPNG().toString("base64");
      return { success: true, base64 };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Screenshot capture failed";
      console.error("[Preview] Screenshot capture failed:", err);
      return { success: false, error: message };
    } finally {
      captureWindow.destroy();
    }
  }
);
electron.ipcMain.handle("settings:get", () => {
  return loadSettings();
});
electron.ipcMain.handle("settings:set", (_event, settings) => {
  saveSettings(settings);
  return { success: true };
});
electron.ipcMain.handle("dialog:selectDirectory", async () => {
  if (!win) return { success: false, error: "No window available" };
  const result = await electron.dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select Projects Directory"
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  return { success: true, path: result.filePaths[0] };
});
async function getDirectorySize(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        `powershell -command "(Get-ChildItem -Path '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: 3e4 }
      );
      const size = parseInt(stdout.trim(), 10);
      return isNaN(size) ? 0 : size;
    } else {
      const { stdout } = await execAsync(
        `du -sk "${dirPath}" 2>/dev/null || echo "0"`,
        { timeout: 3e4 }
      );
      const sizeKB = parseInt(stdout.split("	")[0], 10);
      return isNaN(sizeKB) ? 0 : sizeKB * 1024;
    }
  } catch {
    return 0;
  }
}
async function getDiskSpace(dirPath) {
  try {
    if (process.platform === "win32") {
      const driveLetter = path.parse(dirPath).root || "C:\\";
      const { stdout } = await execAsync(
        `powershell -command "Get-PSDrive -Name '${driveLetter[0]}' | Select-Object Used,Free | ConvertTo-Json"`,
        { timeout: 1e4 }
      );
      const info = JSON.parse(stdout);
      return {
        total: (info.Used || 0) + (info.Free || 0),
        free: info.Free || 0
      };
    } else {
      const { stdout } = await execAsync(
        `df -k "${dirPath}" 2>/dev/null | tail -1`,
        { timeout: 1e4 }
      );
      const parts = stdout.trim().split(/\s+/);
      const totalKB = parseInt(parts[1], 10);
      const availableKB = parseInt(parts[3], 10);
      return {
        total: isNaN(totalKB) ? 0 : totalKB * 1024,
        free: isNaN(availableKB) ? 0 : availableKB * 1024
      };
    }
  } catch {
    return { total: 0, free: 0 };
  }
}
electron.ipcMain.handle("storage:getUsage", async () => {
  const settings = loadSettings();
  const projectsDir = settings.projectsDirectory;
  const userDataDir = electron.app.getPath("userData");
  const logsDir = electron.app.getPath("logs");
  const [projectsSize, logsSize] = await Promise.all([
    getDirectorySize(projectsDir),
    getDirectorySize(logsDir)
  ]);
  let dependenciesSize = 0;
  let buildCacheSize = 0;
  if (fs.existsSync(projectsDir)) {
    try {
      const projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      const sizes = await Promise.all(
        projects.map(async (project) => {
          const projectPath = path.join(projectsDir, project.name);
          const nodeModulesPath = path.join(projectPath, "node_modules");
          const distPath = path.join(projectPath, "dist");
          const buildPath = path.join(projectPath, "build");
          const nextCachePath = path.join(projectPath, ".next");
          const [nodeModules, dist, build, nextCache] = await Promise.all([
            getDirectorySize(nodeModulesPath),
            getDirectorySize(distPath),
            getDirectorySize(buildPath),
            getDirectorySize(nextCachePath)
          ]);
          return {
            dependencies: nodeModules,
            buildCache: dist + build + nextCache
          };
        })
      );
      for (const size of sizes) {
        dependenciesSize += size.dependencies;
        buildCacheSize += size.buildCache;
      }
    } catch (err) {
      console.error("Failed to scan project directories:", err);
    }
  }
  const appCachePath = path.join(userDataDir, "Cache");
  const appCache = await getDirectorySize(appCachePath);
  const diskSpace = await getDiskSpace(projectsDir);
  const projectFilesSize = Math.max(0, projectsSize - dependenciesSize - buildCacheSize);
  const totalBuildCache = buildCacheSize + appCache;
  return {
    projects: projectFilesSize,
    dependencies: dependenciesSize,
    buildCache: totalBuildCache,
    logs: logsSize,
    total: projectFilesSize + dependenciesSize + totalBuildCache + logsSize,
    diskTotal: diskSpace.total,
    diskFree: diskSpace.free
  };
});
electron.ipcMain.handle("storage:listProjects", async () => {
  const settings = loadSettings();
  const projectsDir = settings.projectsDirectory;
  if (!fs.existsSync(projectsDir)) {
    return [];
  }
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
    const projects = await Promise.all(
      entries.map(async (entry) => {
        const projectPath = path.join(projectsDir, entry.name);
        const size = await getDirectorySize(projectPath);
        let lastModified = Date.now();
        try {
          const stats = fs.statSync(projectPath);
          lastModified = stats.mtimeMs;
        } catch {
        }
        return {
          name: entry.name,
          path: projectPath,
          size,
          lastModified
        };
      })
    );
    return projects.sort((a, b) => b.lastModified - a.lastModified);
  } catch (err) {
    console.error("Failed to list projects:", err);
    return [];
  }
});
electron.ipcMain.handle(
  "project:createFolder",
  async (_event, { slug, initGit = true }) => {
    const settings = loadSettings();
    const projectsDir = settings.projectsDirectory;
    const projectPath = path.join(projectsDir, slug);
    try {
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true });
      }
      if (fs.existsSync(projectPath)) {
        return {
          success: false,
          error: `Project folder already exists: ${projectPath}`
        };
      }
      fs.mkdirSync(projectPath, { recursive: true });
      console.log(`[Project] Created folder: ${projectPath}`);
      if (initGit) {
        const { execSync } = await import("child_process");
        try {
          execSync("git init", { cwd: projectPath, stdio: "pipe" });
          console.log(`[Project] Initialized git repo: ${projectPath}`);
          const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Cache
.cache/
.turbo/
`;
          fs.writeFileSync(path.join(projectPath, ".gitignore"), gitignoreContent);
          console.log(`[Project] Created .gitignore`);
        } catch (gitErr) {
          console.warn(`[Project] Git init failed (git may not be installed):`, gitErr);
        }
      }
      return {
        success: true,
        localPath: projectPath
      };
    } catch (err) {
      console.error("[Project] Failed to create folder:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to create project folder"
      };
    }
  }
);
electron.ipcMain.handle(
  "project:getLocalPath",
  (_event, { slug }) => {
    const settings = loadSettings();
    const projectPath = path.join(settings.projectsDirectory, slug);
    return fs.existsSync(projectPath) ? projectPath : null;
  }
);
electron.ipcMain.handle(
  "project:exists",
  (_event, { slug }) => {
    const settings = loadSettings();
    const projectPath = path.join(settings.projectsDirectory, slug);
    return fs.existsSync(projectPath);
  }
);
electron.ipcMain.handle(
  "project:writeFile",
  async (_event, {
    projectPath,
    filePath,
    content
  }) => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      markInternalFsChange(fullPath);
      fs.writeFileSync(fullPath, content, "utf-8");
      const stats = fs.statSync(fullPath);
      console.log(`[Project] Wrote file: ${fullPath}`);
      notifyFileChanged(fullPath, content, { origin: "agent" });
      return {
        success: true,
        fullPath,
        sizeBytes: stats.size
      };
    } catch (error) {
      console.error("[Project] Failed to write file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
);
electron.ipcMain.handle(
  "project:readFile",
  async (_event, { projectPath, filePath }) => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "File not found" };
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      const stats = fs.statSync(fullPath);
      return {
        success: true,
        content,
        sizeBytes: stats.size
      };
    } catch (error) {
      console.error("[Project] Failed to read file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
);
electron.ipcMain.handle(
  "project:readFileBase64",
  async (_event, { projectPath, filePath }) => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "File not found" };
      }
      const buffer = fs.readFileSync(fullPath);
      const stats = fs.statSync(fullPath);
      return {
        success: true,
        base64: buffer.toString("base64"),
        sizeBytes: stats.size
      };
    } catch (error) {
      console.error("[Project] Failed to read file (base64):", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
);
electron.ipcMain.handle(
  "project:listFiles",
  async (_event, { projectPath }) => {
    try {
      let walkDir = function(dir, relativePath = "") {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = path.join(relativePath, entry.name);
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== ".git" && entry.name !== "node_modules") {
              walkDir(fullPath, relPath);
            }
          } else {
            const stats = fs.statSync(fullPath);
            files.push({ path: relPath, sizeBytes: stats.size });
          }
        }
      };
      const files = [];
      walkDir(projectPath);
      return { success: true, files };
    } catch (error) {
      console.error("[Project] Failed to list files:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
);
electron.ipcMain.handle(
  "project:watchStart",
  (_event, { projectPath }) => {
    return startProjectWatcher(projectPath);
  }
);
electron.ipcMain.handle(
  "project:watchStop",
  (_event, { projectPath }) => {
    return stopProjectWatcher(projectPath);
  }
);
electron.ipcMain.handle(
  "fs:readDir",
  async (_event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) {
        return [];
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        const fullPath = path.join(dirPath, entry.name);
        const isDirectory = entry.isDirectory();
        try {
          const stats = fs.statSync(fullPath);
          result.push({
            name: entry.name,
            path: fullPath,
            type: isDirectory ? "directory" : "file",
            size: isDirectory ? void 0 : stats.size,
            modifiedAt: stats.mtime.toISOString()
          });
        } catch {
        }
      }
      return result;
    } catch (error) {
      console.error("[FS] Failed to read directory:", error);
      return [];
    }
  }
);
electron.ipcMain.handle(
  "fs:readFile",
  async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      console.error("[FS] Failed to read file:", error);
      return null;
    }
  }
);
electron.ipcMain.handle(
  "sync:hashFile",
  async (_event, { filePath }) => {
    if (!xxhasher) throw new Error("xxhash not initialized");
    const content = fs.readFileSync(filePath);
    const hash = xxhasher.h64Raw(content).toString(16).padStart(16, "0");
    return { hash, size: content.length };
  }
);
electron.ipcMain.handle(
  "sync:getLocalManifest",
  async (_event, {
    projectPath,
    excludePatterns
  }) => {
    if (!xxhasher) throw new Error("xxhash not initialized");
    const defaultExcludes = ["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"];
    const excludes = /* @__PURE__ */ new Set([...defaultExcludes, ...excludePatterns || []]);
    const manifest = [];
    function walkDir(dir, relativePath = "") {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (excludes.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
        const relPath = path.join(relativePath, entry.name);
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath);
            const stats = fs.statSync(fullPath);
            const hash = xxhasher.h64Raw(content).toString(16).padStart(16, "0");
            manifest.push({
              path: relPath.replace(/\\/g, "/"),
              // Normalize to forward slashes
              hash,
              size: stats.size,
              mtime: stats.mtimeMs
            });
          } catch (err) {
            console.warn(`[Sync] Could not read file: ${fullPath}`, err);
          }
        }
      }
    }
    if (fs.existsSync(projectPath)) {
      walkDir(projectPath);
    }
    console.log(`[Sync] Generated manifest with ${manifest.length} files for ${projectPath}`);
    return { manifest, totalFiles: manifest.length };
  }
);
electron.ipcMain.handle(
  "sync:writeFiles",
  async (_event, {
    projectPath,
    files
  }) => {
    const results = [];
    for (const file of files) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, file.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        markInternalFsChange(fullPath);
        if (file.encoding === "base64") {
          fs.writeFileSync(fullPath, Buffer.from(file.content, "base64"));
        } else {
          fs.writeFileSync(fullPath, file.content, "utf-8");
        }
        results.push({ path: file.path, success: true });
        console.log(`[Sync] Wrote file: ${file.path}`);
        if (file.encoding !== "base64") {
          notifyFileChanged(fullPath, file.content, { origin: "sync" });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.push({ path: file.path, success: false, error: errorMsg });
        console.error(`[Sync] Failed to write file: ${file.path}`, err);
      }
    }
    return { results, successCount: results.filter((r) => r.success).length };
  }
);
electron.ipcMain.handle(
  "sync:deleteFiles",
  async (_event, {
    projectPath,
    paths
  }) => {
    const results = [];
    for (const relPath of paths) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, relPath);
        if (fs.existsSync(fullPath)) {
          markInternalFsChange(fullPath);
          fs.unlinkSync(fullPath);
          console.log(`[Sync] Deleted file: ${relPath}`);
        }
        results.push({ path: relPath, success: true });
        notifyFileDeleted(fullPath, { origin: "sync" });
      } catch (err) {
        console.error(`[Sync] Failed to delete file: ${relPath}`, err);
        results.push({ path: relPath, success: false });
      }
    }
    return { results };
  }
);
electron.ipcMain.handle(
  "devServer:start",
  async (_event, {
    projectPath,
    command,
    port,
    cols = 80,
    rows = 24
  }) => {
    if (devServerProcesses.has(projectPath)) {
      return { success: false, error: "Dev server already running for this project" };
    }
    try {
      console.log(`[DevServer] Starting PTY: ${command} in ${projectPath} (${cols}x${rows})`);
      const shell2 = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
      const ptyProcess = pty__namespace.spawn(shell2, ["-c", command], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: String(port),
          FORCE_COLOR: "1",
          TERM: "xterm-256color"
        }
      });
      devServerProcesses.set(projectPath, ptyProcess);
      ptyProcess.onData((data) => {
        win?.webContents.send("devServer:output", { projectPath, output: data, stream: "stdout" });
      });
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[DevServer] PTY exited with code ${exitCode}`);
        devServerProcesses.delete(projectPath);
        win?.webContents.send("devServer:exit", { projectPath, code: exitCode });
      });
      return { success: true, pid: ptyProcess.pid };
    } catch (err) {
      console.error("[DevServer] Failed to start PTY:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to start dev server"
      };
    }
  }
);
electron.ipcMain.handle(
  "devServer:stop",
  async (_event, { projectPath }) => {
    const ptyProcess = devServerProcesses.get(projectPath);
    if (!ptyProcess) {
      return { success: true };
    }
    try {
      console.log(`[DevServer] Stopping PTY for ${projectPath}`);
      ptyProcess.kill();
      devServerProcesses.delete(projectPath);
      return { success: true };
    } catch (err) {
      console.error("[DevServer] Failed to stop PTY:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to stop dev server"
      };
    }
  }
);
electron.ipcMain.handle(
  "devServer:resize",
  (_event, { projectPath, cols, rows }) => {
    const ptyProcess = devServerProcesses.get(projectPath);
    if (!ptyProcess) {
      return { success: false };
    }
    try {
      ptyProcess.resize(cols, rows);
      return { success: true };
    } catch (err) {
      console.error("[DevServer] Failed to resize PTY:", err);
      return { success: false };
    }
  }
);
electron.ipcMain.handle(
  "devServer:isRunning",
  (_event, { projectPath }) => {
    return devServerProcesses.has(projectPath);
  }
);
electron.ipcMain.handle(
  "terminal:create",
  async (_event, {
    projectPath,
    profileId,
    cwd,
    cols = 80,
    rows = 24
  }) => {
    try {
      const terminalId = crypto.randomUUID();
      const profile = getTerminalProfile(profileId);
      console.log(`[Terminal] Creating terminal ${terminalId} with profile ${profile.name} in ${cwd || projectPath}`);
      const ptyProcess = pty__namespace.spawn(profile.path, profile.args || [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: cwd || projectPath,
        env: {
          ...process.env,
          ...profile.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor"
        }
      });
      const terminal = {
        id: terminalId,
        projectPath,
        ptyProcess,
        profile,
        title: profile.name
      };
      terminals.set(terminalId, terminal);
      const projectTerms = projectTerminals.get(projectPath) || [];
      projectTerms.push(terminalId);
      projectTerminals.set(projectPath, projectTerms);
      ptyProcess.onData((data) => {
        win?.webContents.send("terminal:output", { terminalId, data });
      });
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[Terminal] Terminal ${terminalId} exited with code ${exitCode}`);
        win?.webContents.send("terminal:exit", { terminalId, exitCode });
        terminals.delete(terminalId);
        const projectTerms2 = projectTerminals.get(projectPath);
        if (projectTerms2) {
          const idx = projectTerms2.indexOf(terminalId);
          if (idx !== -1) projectTerms2.splice(idx, 1);
          if (projectTerms2.length === 0) {
            projectTerminals.delete(projectPath);
          }
        }
      });
      return { success: true, terminalId };
    } catch (err) {
      console.error("[Terminal] Failed to create terminal:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to create terminal"
      };
    }
  }
);
electron.ipcMain.handle(
  "terminal:input",
  async (_event, { terminalId, data }) => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      terminal.ptyProcess.write(data);
    }
  }
);
electron.ipcMain.handle(
  "terminal:resize",
  (_event, { terminalId, cols, rows }) => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      try {
        terminal.ptyProcess.resize(cols, rows);
        return { success: true };
      } catch (err) {
        console.error("[Terminal] Failed to resize:", err);
        return { success: false };
      }
    }
    return { success: false };
  }
);
electron.ipcMain.handle(
  "terminal:kill",
  async (_event, { terminalId }) => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      try {
        console.log(`[Terminal] Killing terminal ${terminalId}`);
        terminal.ptyProcess.kill();
        terminals.delete(terminalId);
        const projectTerms = projectTerminals.get(terminal.projectPath);
        if (projectTerms) {
          const idx = projectTerms.indexOf(terminalId);
          if (idx !== -1) projectTerms.splice(idx, 1);
          if (projectTerms.length === 0) {
            projectTerminals.delete(terminal.projectPath);
          }
        }
        return { success: true };
      } catch (err) {
        console.error("[Terminal] Failed to kill:", err);
        return { success: false };
      }
    }
    return { success: true };
  }
);
electron.ipcMain.handle(
  "terminal:getProfiles",
  () => {
    return detectTerminalProfiles();
  }
);
electron.ipcMain.handle(
  "terminal:list",
  (_event, { projectPath }) => {
    return projectTerminals.get(projectPath) || [];
  }
);
electron.ipcMain.handle(
  "terminal:getInfo",
  (_event, { terminalId }) => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      return {
        id: terminal.id,
        profileId: terminal.profile.id,
        profileName: terminal.profile.name,
        title: terminal.title
      };
    }
    return null;
  }
);
electron.app.on("window-all-closed", () => {
  for (const [projectPath, ptyProcess] of devServerProcesses) {
    console.log(`[DevServer] Killing PTY for ${projectPath}`);
    try {
      ptyProcess.kill();
    } catch {
    }
  }
  devServerProcesses.clear();
  for (const [terminalId, terminal] of terminals) {
    console.log(`[Terminal] Killing terminal ${terminalId}`);
    try {
      terminal.ptyProcess.kill();
    } catch {
    }
  }
  terminals.clear();
  projectTerminals.clear();
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(async () => {
  xxhasher = await xxhashInit();
  console.log("[Sync] xxhash initialized");
  createWindow();
});
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
