# `src/experimental/`

A fully isolated sandbox for ideas that don't belong in the main locala
app yet but are worth prototyping on top of the same `@web-ai-sdk`
packages locala already depends on.

The contract is intentionally narrow:

- **No reverse coupling.** Code in `src/` (outside `experimental/`)
  never imports from `src/experimental/`. The only edge is the hash
  router mounted in `src/main.tsx`, which renders `ExperimentalRoute`
  alongside the main `App` so URLs like `#experimental/agent` open the
  experiment full-screen without touching app state.
- **Self-contained styling.** Each experiment scopes its CSS under a
  prefix (e.g. `.agentp__*`). Nothing in the main stylesheet has to
  change to enable or disable an experiment.
- **Cheap to delete.** Removing an experiment is `rm -r
  src/experimental/<name>/`, removing its hash route from
  `ExperimentalRoute.tsx`, and removing any optional link from the
  Workspace panel.
- **Easy to lift.** Each experiment is structured so its top-level
  folder maps 1:1 to a future standalone package. The agent prototype
  in `agent/` is laid out to be `cp -r`-able into whatever kit-layer
  package eventually ships the agent loop primitive (see
  `web-ai-sdk/kit/.ideas/agent.md` for the design proposal).

## Current experiments

| Folder         | Status        | URL hash               | Notes                                                                           |
| -------------- | ------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `agent/`       | prototype     | n/a (library)          | On-device agent loop over `@web-ai-sdk/prompt`. Implements the proposal in `web-ai-sdk/kit/.ideas/agent.md`. See its README. |
| `playground/`  | demo UI       | `#experimental/agent`  | Chat-style playground that exercises the agent + preset toolbelts. See `playground/README.md` for renderer/tool adapter decisions and lift notes. |

## How to add a new experiment

1. `mkdir src/experimental/<name>/` and put the library code there.
2. If it needs a UI, add a `playground/` (or similar) alongside.
3. Register a hash in `ExperimentalRoute.tsx` and render the entry
   component.
4. Optionally add a one-line link in `src/components/Workspace.tsx`
   under the "Experimental" pane so the experiment is discoverable.
5. Write a `README.md` next to the code, including a "lift plan" if
   it's intended to graduate to a kit/SDK package.
