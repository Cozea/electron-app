import type {
  DevServerPreviewScrollInput,
  DevServerPreviewTarget,
  DevServerPreviewTypeInput,
  DevServerPreviewWaitForInput,
} from '../../../../shared/devServerPreviewAutomationTypes'

function json(value: unknown): string {
  return JSON.stringify(value)
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildTargetResolver(target: DevServerPreviewTarget): string {
  return `(() => {
    const selector = ${json(target.selector ?? null)};
    const locator = ${json(target.locator ?? null)};
    const accessibleName = (el) => {
      const aria = (el.getAttribute("aria-label") || "").trim();
      if (aria) return aria;
      const labelledBy = (el.getAttribute("aria-labelledby") || "").trim();
      if (labelledBy) {
        const value = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
        if (value) return value;
      }
      return (el.getAttribute("placeholder") || el.getAttribute("title") || el.textContent || "").replace(/\\s+/g, " ").trim();
    };
    const implicitRole = (el) => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && el.hasAttribute("href")) return "link";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset"].includes(type)) return "button";
        return "textbox";
      }
      return null;
    };
    const queryCss = (value) => {
      try { return { element: document.querySelector(value), error: null }; }
      catch (error) { return { element: null, error: String(error?.message || error) }; }
    };
    if (selector) return queryCss(selector);
    if (!locator) return { element: document.activeElement, error: null };
    if (locator.startsWith("text=")) {
      const expected = locator.slice(5);
      const candidates = document.querySelectorAll("button,a,input,textarea,select,[role],[tabindex]");
      return { element: Array.from(candidates).find((el) => accessibleName(el).includes(expected)) || null, error: null };
    }
    const roleMatch = locator.match(/^role=([a-zA-Z0-9_-]+)(?:\\[name=(?:'([^']*)'|"([^"]*)"|([^\\]]+))\\])?$/);
    if (roleMatch) {
      const expectedRole = roleMatch[1];
      const expectedName = roleMatch[2] ?? roleMatch[3] ?? roleMatch[4] ?? null;
      const candidates = document.querySelectorAll("button,a,input,textarea,select,summary,[role],[tabindex]");
      const element = Array.from(candidates).find((el) => {
        if (implicitRole(el) !== expectedRole) return false;
        return expectedName === null || accessibleName(el) === expectedName;
      });
      return { element: element || null, error: null };
    }
    return queryCss(locator);
  })()`
}

export function buildDevServerPreviewClickScript(target: DevServerPreviewTarget): string {
  return `(() => {
    const resolved = ${buildTargetResolver(target)};
    if (resolved.error) return { ok: false, error: "invalid_selector", message: resolved.error };
    const el = resolved.element;
    if (!el) return { ok: false, error: "not_found", message: "No element matched the requested target." };
    try {
      el.scrollIntoView?.({ block: "center", inline: "center" });
      el.focus?.();
      el.click?.();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: "not_found", message: String(error?.message || error) };
    }
  })()`
}

export function buildDevServerPreviewTypeScript(input: DevServerPreviewTypeInput): string {
  return `(() => {
    const resolved = ${buildTargetResolver(input)};
    if (resolved.error) return { ok: false, error: "invalid_selector", message: resolved.error };
    const el = resolved.element;
    if (!el) return { ok: false, error: "not_found", message: "No element matched the requested target." };
    const text = ${json(input.text)};
    const clear = ${input.clear === true};
    const tag = (el.tagName || "").toLowerCase();
    const editable = tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    if (!editable) return { ok: false, error: "not_editable", message: "Target is not editable." };
    try {
      el.focus?.();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const prototype = tag === "textarea"
          ? HTMLTextAreaElement.prototype
          : tag === "select"
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        const nextValue = clear ? text : String(el.value || "") + text;
        if (setter) setter.call(el, nextValue); else el.value = nextValue;
      } else {
        el.textContent = clear ? text : String(el.textContent || "") + text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: "not_editable", message: String(error?.message || error) };
    }
  })()`
}

export function buildDevServerPreviewScrollScript(input: DevServerPreviewScrollInput): string {
  return `(() => {
    const hasTarget = ${Boolean(input.selector || input.locator)};
    const resolved = hasTarget ? ${buildTargetResolver(input)} : { element: window, error: null };
    if (resolved.error) return { ok: false, error: "invalid_selector", message: resolved.error };
    if (!resolved.element) return { ok: false, error: "not_found", message: "No scroll target matched." };
    resolved.element.scrollBy?.({ left: ${finiteNumber(input.deltaX, 0)}, top: ${finiteNumber(input.deltaY, 0)}, behavior: "auto" });
    return { ok: true };
  })()`
}

export function buildDevServerPreviewWaitForScript(input: DevServerPreviewWaitForInput): string {
  const timeoutMs = Math.min(60_000, Math.max(1, finiteNumber(input.timeoutMs, 15_000)))
  return `(async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() <= deadline) {
      const resolved = ${buildTargetResolver(input)};
      if (resolved.error) return { ok: false, error: "invalid_selector", message: resolved.error };
      const targetMatches = ${Boolean(input.selector || input.locator)} ? Boolean(resolved.element) : true;
      const textMatches = ${json(input.text ?? null)} === null || String(document.body?.innerText || "").includes(${json(input.text ?? '')});
      const urlMatches = ${json(input.urlIncludes ?? null)} === null || String(location.href).includes(${json(input.urlIncludes ?? '')});
      if (targetMatches && textMatches && urlMatches) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, error: "timeout", message: "Preview wait condition timed out." };
  })()`
}
