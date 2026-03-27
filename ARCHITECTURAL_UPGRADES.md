# Architectural Upgrades (from T3Code)

Based on the analysis of the T3Code repository, here are 4 major architectural upgrades that we can migrate the rest of our app to, since the project is not yet in production:

### 1. 100% Type-Safe Routing (`@tanstack/react-router`)
Our main app is currently using the older `react-router-dom`. T3Code uses `@tanstack/react-router` exclusively. It provides fully type-safe, file-based routing. This means you can never accidentally link to a broken URL or pass the wrong search parameters because TypeScript will catch it at compile time.
* **Action:** Rip out `react-router-dom` and migrate our `src/router/` to TanStack Router.

### 2. Rich Text Composers (`lexical` instead of `<textarea>`)
For their chat input and code editors, T3Code uses **Lexical** (Facebook's incredibly powerful, extensible text editor framework). Instead of a standard HTML `<textarea>`, Lexical allows for rich mentions (like typing `@terminal` to link terminal output), inline syntax highlighting, and live token counting as the user types.
* **Action:** Replace our basic text inputs with a Lexical-powered composer.

### 3. Lightning-Fast Rust Tooling (`oxlint` & `oxfmt`)
Our app currently uses standard ESLint and Prettier, which can get incredibly slow as the monorepo grows. T3Code has entirely migrated to **Oxc** (`oxlint` and `oxfmt`). These are written in Rust and are literally 50x to 100x faster than ESLint/Prettier, providing instant linting feedback on save.
* **Action:** Rip out our `.eslintrc` and `prettier` configs and swap them for `oxlint`.

### 4. Headless Accessibility (`@base-ui/react`)
T3Code uses the brand new `@base-ui/react` (released by the Material UI team). It provides highly accessible, unstyled primitives (dropdowns, popovers, tooltips) that are much lighter and faster than Radix/shadcn, giving ultimate control over the Tailwind styling without fighting the DOM.
* **Action:** Start swapping our bulky UI components for Base UI primitives.