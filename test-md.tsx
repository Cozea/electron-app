import { renderToString } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const text = `> Run \`yarn install\` to apply the updates.
> -|--------||
> electron-chrome-context-menu | TypeScript ^4.1.3 -> ^5.7.3 ||
> electron-chrome-extensions | TypeScript ^4.9.4 -> ^5.7.3 , debug ^4.3.1 -> ^4.4.0 ||
> electron-chrome-web-store | debug ^4.3.7 -> ^4.4.0 , @types/chrome ^0.0.287 -> ^0.0.300 |
> | tsconfig.base.json | Target/lib: es2019 -> ES2022 |
>
> Run \`yarn install\` to apply the updates.
`;

console.log(renderToString(<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>));
