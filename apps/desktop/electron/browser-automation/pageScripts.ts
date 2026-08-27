/**
 * In-page scripts for a11y-lite snapshot, click, and type.
 * Kept as pure string builders so the adapter stays testable without Electron.
 */

const MAX_VISIBLE_TEXT = 12_000
const MAX_INTERACTIVE = 80

export interface PageSnapshotScriptResult {
  url: string
  title: string
  visibleText: string
  interactiveElements: Array<{
    tag: string
    role: string | null
    name: string
    selector: string
  }>
}

export interface PageActionScriptResult {
  ok: boolean
  error?: "not_found" | "not_editable" | "invalid_selector"
  message?: string
}

function escapeForSingleQuotedJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/**
 * Builds an IIFE that returns title, visible text, and a compact interactive list.
 */
export function buildSnapshotScript(): string {
  return `(() => {
  const MAX_TEXT = ${MAX_VISIBLE_TEXT};
  const MAX_INTERACTIVE = ${MAX_INTERACTIVE};
  const visibleText = (() => {
    try {
      const raw = document.body ? (document.body.innerText || document.body.textContent || "") : "";
      return String(raw).replace(/\\s+/g, " ").trim().slice(0, MAX_TEXT);
    } catch {
      return "";
    }
  })();

  const cssEscape = (value) => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  };

  const buildSelector = (el) => {
    if (!(el instanceof Element)) return "";
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      const tag = node.tagName.toLowerCase();
      let part = tag;
      if (node.classList && node.classList.length > 0) {
        const cls = Array.from(node.classList).slice(0, 2).map(cssEscape).join(".");
        if (cls) part += "." + cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(node) + 1;
          part += ":nth-of-type(" + index + ")";
        }
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(" > ");
  };

  const accessibleName = (el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map((id) => {
        const ref = document.getElementById(id);
        return ref ? (ref.innerText || ref.textContent || "").trim() : "";
      });
      const joined = parts.filter(Boolean).join(" ").trim();
      if (joined) return joined.slice(0, 120);
    }
    const aria = (el.getAttribute("aria-label") || "").trim();
    if (aria) return aria.slice(0, 120);
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title.slice(0, 120);
    const placeholder = (el.getAttribute("placeholder") || "").trim();
    if (placeholder) return placeholder.slice(0, 120);
    const alt = (el.getAttribute("alt") || "").trim();
    if (alt) return alt.slice(0, 120);
    const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    return text.slice(0, 120);
  };

  const interactiveSelector = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='textbox']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='menuitem']",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const interactiveElements = [];
  try {
    const nodes = document.querySelectorAll(interactiveSelector);
    for (let i = 0; i < nodes.length && interactiveElements.length < MAX_INTERACTIVE; i++) {
      const el = nodes[i];
      if (!(el instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      interactiveElements.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        name: accessibleName(el),
        selector: buildSelector(el),
      });
    }
  } catch {
    // ignore query failures
  }

  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    visibleText,
    interactiveElements,
  };
})()`
}

export function buildClickScript(selector: string): string {
  const escaped = escapeForSingleQuotedJsString(selector)
  return `(() => {
  const selector = '${escaped}';
  let el;
  try {
    el = document.querySelector(selector);
  } catch (error) {
    return { ok: false, error: "invalid_selector", message: String(error && error.message ? error.message : error) };
  }
  if (!el) {
    return { ok: false, error: "not_found", message: "No element matched selector." };
  }
  try {
    if (typeof el.focus === "function") el.focus();
    if (typeof el.click === "function") {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "not_found", message: String(error && error.message ? error.message : error) };
  }
})()`
}

export function buildTypeScript(options: {
  selector?: string
  text: string
  clear: boolean
}): string {
  const selector = options.selector ? escapeForSingleQuotedJsString(options.selector) : ""
  const text = escapeForSingleQuotedJsString(options.text)
  const clear = options.clear ? "true" : "false"
  const hasSelector = Boolean(options.selector)

  return `(() => {
  const hasSelector = ${hasSelector ? "true" : "false"};
  const selector = '${selector}';
  const text = '${text}';
  const clear = ${clear};
  let el;
  if (hasSelector) {
    try {
      el = document.querySelector(selector);
    } catch (error) {
      return { ok: false, error: "invalid_selector", message: String(error && error.message ? error.message : error) };
    }
    if (!el) {
      return { ok: false, error: "not_found", message: "No element matched selector." };
    }
  } else {
    el = document.activeElement;
  }
  if (!el) {
    return { ok: false, error: "not_editable", message: "No editable target." };
  }
  const tag = (el.tagName || "").toLowerCase();
  const isContentEditable = Boolean(el.isContentEditable);
  const isInputLike = tag === "input" || tag === "textarea" || tag === "select";
  if (!isInputLike && !isContentEditable) {
    return { ok: false, error: "not_editable", message: "Target is not editable." };
  }
  try {
    if (typeof el.focus === "function") el.focus();
    if (isInputLike) {
      if (clear) el.value = "";
      el.value = clear ? text : String(el.value || "") + text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      if (clear) el.textContent = "";
      el.textContent = clear ? text : String(el.textContent || "") + text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "not_editable", message: String(error && error.message ? error.message : error) };
  }
})()`
}
