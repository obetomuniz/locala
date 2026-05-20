# locala

Local agents in your browser. On-device chat using the Web Built-in AI APIs, with zero round-trips to a backend.

- All inference runs on-device via `navigator.LanguageModel` (Chrome / Edge Built-in AI).
- A small set of personas (Concise, Explorer, Coder) you can pick per chat.
- Chats are persisted to `localStorage`. Nothing leaves the browser.
- External agents (Chrome agent, Cursor, Claude, etc.) can drive the app via WebMCP tools (`list_chats`, `new_chat`, `send_message`, `set_mode`, ...).

## Built on web-ai-sdk

locala is a consumer of [`@web-ai-sdk`](https://github.com/obetomuniz/web-ai-sdk), a set of headless wrappers for the browser's Built-in AI APIs:

- [`@web-ai-sdk/prompt`](https://www.npmjs.com/package/@web-ai-sdk/prompt) powers the chat (system prompts, streaming, abort, warm-session reuse).
- [`@web-ai-sdk/webmcp`](https://www.npmjs.com/package/@web-ai-sdk/webmcp) exposes the in-app tools to external agents.

See [web-ai-sdk.dev](https://web-ai-sdk.dev/) for the docs.

## Browser requirements

The Web Built-in AI APIs are still behind flags. The compatibility matrix moves; treat this as a starting point and verify against [web-ai-sdk.dev](https://web-ai-sdk.dev/).

- **Prompt API**: Chrome 138+ or Edge 138+ with the Prompt API flag enabled.
- **WebMCP** (optional, only needed for external agent drive-through): Chrome 146+ / Edge 146+ with the WebMCP testing flag.

If the Prompt API isn't available, the UI shows a banner with the flag URL.

## Develop

Requirements: Node 20+, pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Type-check and production build:

```sh
pnpm typecheck
pnpm build
```

## Deploy

The app deploys to GitHub Pages automatically when `main` is updated. The workflow lives at `.github/workflows/deploy.yml`.

For Pages to work the repo must be public (or you need a GitHub Pro plan), and Pages must be set to "GitHub Actions" as the source in repo settings.

## License

[MIT](./LICENSE) © Beto Muniz
