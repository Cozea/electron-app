import { r as reactExports, N, c as cr, j as jsxRuntimeExports, a as ao, b } from "./index-CWKXLA22.js";
var H = b("block", "before:content-[counter(line)]", "before:inline-block", "before:[counter-increment:line]", "before:w-6", "before:mr-4", "before:text-[13px]", "before:text-right", "before:text-muted-foreground/50", "before:font-mono", "before:select-none"), k = reactExports.memo(({ children: o, result: e, language: s, className: a$1, ...p }) => {
  let d = reactExports.useMemo(() => ({ backgroundColor: e.bg, color: e.fg }), [e.bg, e.fg]);
  return jsxRuntimeExports.jsx("pre", { className: b(a$1, "p-4 text-sm dark:bg-(--shiki-dark-bg)!"), "data-language": s, "data-streamdown": "code-block-body", style: d, ...p, children: jsxRuntimeExports.jsx("code", { className: "[counter-increment:line_0] [counter-reset:line]", children: e.tokens.map((l, r) => jsxRuntimeExports.jsx("span", { className: H, children: l.map((t, n) => jsxRuntimeExports.jsx("span", { className: "dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!", style: { color: t.color, backgroundColor: t.bgColor, ...t.htmlStyle }, ...t.htmlAttrs, children: t.content }, n)) }, r)) }) });
}, (o, e) => o.result === e.result && o.language === e.language && o.className === e.className);
var C = ({ className: o, language: e, style: s, ...a$1 }) => jsxRuntimeExports.jsx("div", { className: b("my-4 w-full overflow-hidden rounded-xl border border-border", o), "data-language": e, "data-streamdown": "code-block", style: { contentVisibility: "auto", containIntrinsicSize: "auto 200px", ...s }, ...a$1 });
var h = ({ language: o, children: e }) => jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between bg-muted/80 p-3 text-muted-foreground text-xs", "data-language": o, "data-streamdown": "code-block-header", children: [jsxRuntimeExports.jsx("span", { className: "ml-1 font-mono lowercase", children: o }), jsxRuntimeExports.jsx("div", { className: "flex items-center gap-2", children: e })] });
var W = ({ code: o, language: e, className: s, children: a, ...p }) => {
  let { shikiTheme: d } = reactExports.useContext(N), l = cr(), r = reactExports.useMemo(() => ({ bg: "transparent", fg: "inherit", tokens: o.split(`
`).map((c) => [{ content: c, color: "inherit", bgColor: "transparent", htmlStyle: {}, offset: 0 }]) }), [o]), [t, n] = reactExports.useState(r);
  return reactExports.useEffect(() => {
    if (!l) {
      n(r);
      return;
    }
    let c = l.highlight({ code: o, language: e, themes: d }, (B) => {
      n(B);
    });
    if (c) {
      n(c);
      return;
    }
    n(r);
  }, [o, e, d, l, r]), jsxRuntimeExports.jsx(ao.Provider, { value: { code: o }, children: jsxRuntimeExports.jsxs(C, { language: e, children: [jsxRuntimeExports.jsx(h, { language: e, children: a }), jsxRuntimeExports.jsx(k, { className: s, language: e, result: t, ...p })] }) });
};
export {
  W as CodeBlock
};
