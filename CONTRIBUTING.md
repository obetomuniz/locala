# Contributing to locala

Thanks for taking a look. locala is an early proof of concept for a fully on-device, browser-native AI chat app built on top of [`web-ai-sdk`](https://github.com/obetomuniz/web-ai-sdk). Issues and PRs are welcome.

## Setup

Requirements:

- Node 22+ (pnpm 11 requires it)
- pnpm 11+ (locked via `packageManager`)
- A browser with the Web Built-in AI APIs enabled (Chrome 138+ or Edge 138+, with the Prompt API flag). See the [README](./README.md#browser-requirements) for the flag URLs.

```sh
pnpm install
pnpm dev
```

## Checks before opening a PR

```sh
pnpm typecheck   # tsc -b --noEmit
pnpm build       # production build
```

Both must pass.

## What we're looking for

Good fits:

- Bug fixes in the chat list / chat management / WebMCP tool surface.
- Small, focused UX polish (animations, accessibility, keyboard navigation).
- New persona modes that are genuinely distinct from the existing ones.
- Improvements to the activity / workspace pane.

Less likely to merge:

- Heavy framework changes (Next, Remix, etc.). The PoC stays Vite + React.
- A bundled icon library, design system, or CSS framework.
- Anything that sends user input off-device by default.

## Style

- TypeScript strict, no `any` without a good reason.
- One concern per PR; small diffs over big ones.
- Match the existing dark / minimal / subtle-neumorphism visual language.
- No em-dashes in code or UI strings.

## License

By contributing you agree your contribution is licensed under the [MIT](./LICENSE) license.
