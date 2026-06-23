# Session Handoff - Terminal Dock Redesign

## Latest Update - VS Code-like Terminal Dock

Current branch: `feature/terminal-dock-redesign`

## Latest Update - Terminal Output Capture Demo

Changes:

- Default `Run opencode` command is now
  `npx.cmd -y opencode-ai@1.17.9`, while still remaining editable in Command
  Templates for offline bundle paths.
- `TerminalSurface` exposes screen-buffer and recent-output extraction APIs for
  automation, so the main IM handoff path no longer depends on fragile mouse
  selection.
- Added `Capture Output`, `Auto Receive`, and `Auto Send` controls. Auto Send
  is off by default; when enabled it sends through ChatFooter events rather than
  calling IM SDK from Terminal Dock.
- Extended chat input events with replace/send flows for terminal capture.
- Improved dark ANSI handling for blue, bright blue, black, bright black,
  256-color dark blue, and truecolor dark blue output.

Known limit:

- Capture is a demo using xterm visible screen text first and cleaned recent PTY
  output as fallback. It does not parse opencode's internal session API or
  guarantee exact final-answer extraction across all CLI runtimes.

## Follow-up Fix - White ANSI Blue and opencode Local Smoke

Reason:

- PowerShell and other CLIs often print paths/prompts with ANSI blue. The xterm
  theme rendered blue too dark on the black terminal background, so terminal
  text looked unreadable.
- The IM-to-terminal context flow was discoverable only as separate export and
  paste actions.
- The user-provided local model endpoint is intended for agent runtimes such as
  opencode, not for OpenIM to call directly.

Fix:

- Map ANSI `blue` to `#f2f2f2` and `brightBlue` to `#ffffff` in
  `TerminalSurface`, so blue CLI output is shown as readable white.
- Add CSS overrides for xterm ANSI blue classes as a renderer-level fallback.
- Replace the visible `Context -> Terminal` action with `Copy Context Prompt`.
  It exports the current IM context to workspace markdown files and copies a
  short, single-line prompt that references those files. It does not write the
  prompt into terminal stdin by default.
- Keep explicit `Paste copied prompt into terminal input` as a secondary action
  for cases where the user is already inside a CLI prompt such as opencode TUI.
- Add `docs/terminal-opencode-local.md` with the verified opencode local config.

Follow-up correction:

- Raw multi-line markdown must not be written directly into arbitrary terminal
  stdin. If the terminal is currently in PowerShell, Python REPL, or another
  shell, those lines are interpreted as commands and produce syntax errors.
- The intended data flow is: OpenIM writes IM context markdown files into the
  workspace, then the user tells opencode/codex/etc. to read those files.

opencode smoke result:

```powershell
npx.cmd -y opencode-ai@1.17.9 run --model local-openai/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf "Reply with READY only."
```

Result: `READY`.

Important opencode config note:

- Published package `opencode-ai@1.17.9` uses legacy `provider` config.
- The newer source tree has v2 `providers` schema, but `providers` was rejected
  by the published package during this smoke test.
- OpenIM should not store this API/model config. Put opencode's own
  `opencode.json` in the terminal workspace or rely on opencode's normal config
  and environment handling.

Electron dev note:

- Renderer/CSS changes may hot-reload when the Electron window is connected to
  Vite dev server.
- Electron main/preload/IPC changes require restarting the Electron process.
- If the terminal still shows old colors, reload the Electron window or restart
  the dev Electron client.

## Follow-up Feature - Command Launcher Templates

Reason:

- `opencode run "..."` is a one-shot/script entry and should not be the primary
  path for ongoing opencode interaction.
- The Terminal Dock needs a short VS Code-like `Run opencode` entry while still
  keeping opencode's own config, sessions, skills, memory, and tools outside
  OpenIM.

Changes:

- Added a `Run` dropdown to the Terminal Dock toolbar.
- Default template: `Run opencode` -> injects `opencode` into a new terminal tab.
- Added `Run PowerShell`, `New Terminal`, and `Command Templates` entries.
- Added local command template state persisted in the Terminal Dock localStorage
  state. It stores only command launcher metadata, not runtime API keys/models.
- `Command Templates` lets the user edit the opencode command, for example
  `C:\tools\opencode\opencode.exe` or `npx.cmd -y opencode-ai@1.17.9`.
- `Copy Context Prompt` remains file-based and non-executing; it does not paste
  raw IM context into terminal stdin.

Expected opencode path:

- Interactive default: run `opencode` TUI from the workspace terminal.
- Smoke/script path: use `opencode run ...` manually or via a custom template
  only when one-shot behavior is desired.
- Offline path: point the command template to the offline opencode executable.

Follow-up correction:

- Terminal readability now also normalizes dark-blue ANSI/truecolor output to
  white before writing into xterm, and xterm uses a higher minimum contrast
  ratio.
- Toolbar actions with ambiguous duplicate icons now use visible labels:
  `Start`, `Paste Prompt`, `Selection -> IM`, and `Clear`.
- `Command Templates` now supports adding custom command templates and removing
  non-built-in templates. The built-in `opencode` template can be edited but not
  removed.
- `Selection -> IM` first reads the browser/window text selection, then falls
  back to xterm selection and the most recent non-empty xterm selection cache,
  so selected opencode output can be sent back to IM even if clicking the
  toolbar clears the live xterm selection first.

This phase rebuilds the right-side panel as a Terminal Dock rather than a
runtime manager:

- Chat now mounts `TerminalDock`; the old `RuntimeDock` is no longer mounted.
- The top chat-route button opens `Terminal`, not `Runtime Dock`.
- New renderer store: `src/store/terminalDock.ts`.
- New UI: `src/components/TerminalDock/*`.
- New Electron main bridge: `electron/main/terminalManage.ts`.
- New IPC channels: `terminal:start`, `terminal:write`, `terminal:resize`,
  `terminal:interrupt`, `terminal:stop`, `terminal:event`,
  `terminal:getWorkspaceDir`, `terminal:openWorkspace`.
- Terminal tabs are workspace-bound, not conversation-bound.
- OpenIM does not manage agent runtime internals, API keys, model names,
  provider config, memory, resume IDs, tool calls, or sandbox policy.
- Users run `codex`, `opencode`, `claude`, `gemini`, `openhands`, or any other
  CLI as normal terminal commands.

Current user-facing behavior:

- Ordinary browser/Vite mode shows the new Terminal Dock shell but cannot start
  PTY terminals because `window.electronAPI` is absent.
- Electron mode can create a workspace, create terminal tabs, and start a PTY
  shell through `node-pty`.
- IM context export writes markdown and attachment manifest files into the
  active workspace.
- Context prompt can be copied and pasted into the active terminal.
- Terminal selection can be appended to the current IM input box.
- Automatic "final answer" capture is intentionally not implemented.

Verification for this update:

```bash
npm.cmd run lint -- --quiet
npx.cmd tsc --noEmit
npm.cmd run build
```

All passed during implementation. Build still prints existing Vite/Ant Design
and chunk-size warnings.

Browser/Vite verification:

- Started `npm run dev` and verified `http://localhost:5173`.
- Opened `#/chat/si_2428632797_3297174239`.
- The page showed the new `Terminal` panel shell.
- Browser mode correctly showed `Terminal is available only in the Electron
  client`.
- `Runtime Dock` and `opencode-local` text were absent from the page body.

Electron verification not completed in this pass; PTY launch should be checked
manually in the packaged/dev Electron app.

Git status for this update:

- Local commit: `8c7fab0 feat: redesign terminal dock panel`
- First push attempt:
  `git push -u origin feature/terminal-dock-redesign`
- Result: failed with `Recv failure: Connection was reset`.
- Local branch is saved; remote branch may still need another push when GitHub
  connectivity is stable.

## Follow-up Fix - Terminal Surface Readability/Input

Reason:

- The xterm `onData` callback captured the initial tab status. When the tab was
  created as `detached` and later became `running`, keyboard input was still
  ignored by the stale closure.
- The terminal theme used low-contrast ANSI blue on a dark VS Code background,
  making the PowerShell prompt/path hard to read compared with native Windows
  Terminal.
- The Electron bridge injected a custom `Terminal started in ...` line, which
  made startup look less like a native PowerShell session.

Fix:

- Track running state through a ref and update `disableStdin` whenever tab
  status changes.
- Focus xterm when it is opened/running.
- Switch xterm to a Windows Terminal-like black theme with brighter ANSI blue
  and larger font.
- Remove the custom startup banner and let PowerShell render its own prompt.

Verification:

```bash
npm.cmd run lint -- --quiet
npx.cmd tsc --noEmit
```

Both passed. Electron manual typing verification still needs to be repeated in
the running client.

Known limits:

- Old `RuntimeDock` files remain in the repo but are no longer referenced by
  chat.
- Multi-conversation selection UI is not implemented yet; the data model
  supports linked conversations, and export links the current conversation.
- Terminal output is intentionally in-memory only; tab metadata persists, and
  tabs restart as stopped/detached after reload.
- The Chinese resource file already contains mojibake in this checkout, so this
  update avoids large edits to `zh.json`.

Next recommended phase:

- Add a workspace/conversation picker for exporting multiple IM conversations
  into the same workspace.
- Add attachment copying/downloading into workspace when local files are
  available.
- Add command-template snippets for common CLIs without storing runtime config.
- Add Electron manual test coverage for PTY launch and xterm resize.

## Latest Update - Terminal First

Current branch: `UI-feature`

Runtime Dock has been changed from the misleading `opencode-local` smoke adapter
to a terminal-first host:

- Removed renderer direct calls to `http://127.0.0.1:8080/v1`.
- Removed the Vite `/runtime-local/v1` proxy.
- Electron main now starts a real PowerShell process with `child_process.spawn`.
- Runtime output is streamed through `runtime:event`.
- Renderer writes terminal input through `runtime:writeInput`.
- Existing `opencode-local` localStorage attachments migrate to `PowerShell Terminal`.
- Old model-chat transcript is cleared during migration to avoid misleading users.
- Runtime tools own their own config; OpenIM only hosts the terminal.

Profiles currently built in:

- `powershell-terminal`
- `opencode-terminal` with startup command `opencode --version`

Important limitation:

- This is a stream-based PowerShell child process, not a full PTY yet.
- `node-pty` and `xterm.js` are still recommended next for proper terminal
  semantics.
- Plain browser/Vite mode cannot start terminals because `window.electronAPI`
  is absent; the UI disables terminal controls and requires Electron.

Verification:

```bash
npm.cmd run lint -- --quiet
npx.cmd tsc --noEmit
npm.cmd run build
```

All passed. Browser verification confirmed the old smoke transcript no longer
appears and the migrated attachment shows `PowerShell Terminal`.

## Latest Update - 2026-06-22

Current branch: `UI-feature`

Local baseline commit saved before runtime work:

```text
5f2cd46 chore: save verified UI-feature baseline
```

Runtime work added after that baseline:

- Electron main runtime manager: `electron/main/runtimeManage.ts`
- Runtime IPC channels: `runtime:listProfiles`, `runtime:start`, `runtime:stop`, `runtime:sendPrompt`, `runtime:healthCheck`
- Runtime Dock UI upgraded from placeholder-only to Start / Restart / Stop / Send Prompt.
- `opencode-local` profile added as the first runtime profile.
- Browser dev fallback added through Vite proxy `/runtime-local/v1 -> http://127.0.0.1:8080/v1` so the in-app browser at `localhost:5173` can verify the runtime smoke without Electron IPC.
- Offline bundle contract added:
  - `runtime-bundles/opencode-win-x64-local.manifest.json`
  - `docs/runtime-opencode-offline.md`

Local model contract verified:

- Base URL: `http://127.0.0.1:8080/v1`
- Model: `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`
- Smoke prompt: `Reply with READY only.`
- Result: local model returned `READY`.

Runtime Dock browser smoke passed on `http://localhost:5173/#/chat/si_2428632797_3297174239`:

1. Opened Runtime Dock.
2. Started first `opencode-local` attachment.
3. Dock state changed to `running`.
4. Transcript showed `Runtime is running. Local model endpoint is reachable.`
5. Sent `Reply with READY only.`
6. Transcript showed assistant response `READY`.
7. Stopped runtime.
8. Dock state changed to `stopped` and transcript showed `Runtime stopped.`

Verification commands after runtime work:

```bash
npm.cmd run lint -- --quiet
npx.cmd tsc --noEmit
npm.cmd run build
```

All passed. Build still prints existing Vite/Ant Design/chunk-size warnings.

Important limitation: this is an `opencode-local` runtime adapter smoke using the local OpenAI-compatible model endpoint. It does not yet execute a bundled `opencode run` binary. The offline manifest records the intended external opencode bundle contract; the actual archive checksum is still `TBD_AFTER_BUNDLE_BUILD`.

GitHub push status:

- `gh` was installed successfully with `winget`.
- `gh auth login --hostname github.com --git-protocol https --web` failed before showing a device code because the request to GitHub timed out.
- `Test-NetConnection github.com -Port 443` returned `TcpTestSucceeded: False`.
- `git ls-remote https://github.com/leon-test10/openim-electron-demo.git` failed with `Recv failure: Connection was reset`.
- `git push -u origin UI-feature` failed with `Failed to connect to github.com port 443`.
- Local commits are saved, but remote create/push is blocked by current GitHub network connectivity from this machine.

Recommended next phase:

- Build the actual `opencode-win-x64-local.zip` offline runtime bundle.
- Replace manifest `sha256` with the real archive checksum.
- Wire `runtimeManage.ts` to launch bundled `opencode run` when the bundle is present.
- Keep the current local OpenAI-compatible smoke adapter as a fallback health test.
- Add process log streaming and cancellation semantics before adding other runtimes.

## Project

`openim-electron-demo`

## Branch

- Current branch: `UI-feature`
- Current local base: restored snapshot commit `482ff9a`
- Note: the previous `feature/runtime-dock-panel` branch history is not present in the current local `.git`; the current usable branch is `UI-feature`.

## Current Scope

Runtime Dock remains a Phase 1 frontend scaffold:

- Chat route has a Runtime Dock toggle.
- Dock opens as a right-side panel beside chat.
- Dock stores local placeholder runtime attachments per `conversationID`.
- Placeholder state persists in browser `localStorage`.
- No PTY, xterm.js, real CLI process, provider config, API key config, or server-side runtime persistence is implemented.

## Dependency Status

Docker Desktop was started and `openim-docker` was brought up with:

```bash
docker compose up -d
```

Final `docker compose ps` showed these services running:

- `mongo`
- `redis`
- `etcd`
- `kafka`
- `minio`
- `openim-server` - healthy
- `openim-chat` - healthy
- `openim-web-front`
- `openim-admin-front`

Final port checks:

- `10001`: open
- `10002`: open
- `10008`: open
- `10005`: open
- `11001`: open
- `11002`: open
- `5173`: open

Compose still prints warnings that `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `ETCD_USERNAME`, and `ETCD_PASSWORD` are unset. The current compose file defaults them to blank and the stack still reaches healthy state.

## Frontend Runtime

Started with:

```bash
npm run dev
```

Vite selected:

```text
http://localhost:5173
```

The earlier expected `7777` port was not used by the current `npm run dev` script.

## Validation Evidence

Commands run from `openim-electron-demo`:

```bash
npm.cmd run lint
```

Result: exit 0. Current output has 175 warnings and 0 errors.

```bash
npx.cmd tsc --noEmit
```

Result: exit 0.

```bash
npm.cmd run build
```

Result: exit 0. Vite build completes. Build still prints existing warnings about Terser config, `wasm_exec.js`, Ant Design `"use client"` directives, and large chunks.

```bash
npx.cmd prettier --check "src/**/*.{js,jsx,ts,tsx}"
```

Result: exit 0 after normalizing source files to LF.

## Browser Verification

Created a local test account through `openim-chat`:

- Phone: `19900000002`
- Password: `codex123456`
- User ID: `3297174239`

Then verified in the in-app browser:

- Opened `http://localhost:5173`.
- Logged in through the real login form.
- Reached `#/chat`.
- Runtime Dock icon appears on chat route.
- Runtime Dock opens and shows no-conversation state.
- Navigated to `#/chat/si_3297174239_2428632797`.
- Dock showed the current `conversationID`.
- Clicked `Add Runtime`.
- Placeholder attachment appeared:
  - `Shell Placeholder`
  - `shell-placeholder`
  - `detached`
  - `Terminal will be added in Phase 2`
- Switched to `#/chat/si_3297174239_0000000000`; previous placeholder was not shown.
- Switched back to `#/chat/si_3297174239_2428632797`; placeholder was still shown.
- Reloaded page; Dock open state restored.
- Re-entered the original conversation route; placeholder attachment restored from local state.
- Navigated to `#/contact`; Runtime Dock icon was hidden.

Known browser-route behavior:

- Reloading a deep `#/chat/:conversationID` route returns the app to `#/chat`; after navigating back to the same conversation route, the persisted attachment is restored.

## Two-Account Message E2E

Verified on 2026-06-22 against the local Docker backend and Vite frontend.

Accounts:

- A: `19900000002` / `codex123456` / userID `3297174239` / nickname `Codex Test 2`
- B: `19900000003` / `codex123456` / userID `2428632797` / nickname `Codex Peer`

Flow:

1. Logged in as A in the browser.
2. Searched B by userID `2428632797`.
3. Opened B's user card.
4. Clicked `发送消息`.
5. Sent:

```text
E2E message 2026-06-22T01:26:30.314Z
```

6. Launched an isolated Edge/Playwright browser context.
7. Logged in as B.
8. Opened `#/chat/si_2428632797_3297174239`.
9. Verified B's page contained:

```text
Codex Test 2
E2E message 2026-06-22T01:26:30.314Z
```

Result: two-account message E2E passed.

## opencode Runtime Check

Current state:

- `RuntimeDock` has no `opencode`, `pty`, `node-pty`, `spawn`, or `RuntimeTerminal` integration.
- `opencode` is not available on PATH.
- `where opencode` returned not found.
- The local `opencode` directory is a source checkout using `packageManager: bun@1.3.14`.
- `bun` was not detected in the current shell.

Result: real opencode-in-Runtime-Dock E2E cannot be verified yet because both sides are missing:

- IM Runtime Dock has no process bridge.
- opencode CLI is not installed/runnable in the current environment.

## Code Changes Made During Verification

- Normalized `src/**/*.{js,jsx,ts,tsx}` to LF so Prettier/lint can pass.
- Added `.gitattributes` to keep text files LF.
- Fixed lint errors caused by import ordering, implicit boolean coercion, and `async` methods without `await`.
- Fixed strict TypeScript errors in:
  - `src/components/DraggableModalWrap/index.tsx`
  - `src/hooks/useGroupMembers.ts`
  - `src/pages/chat/queryChat/ChatFooter/index.tsx`
  - `src/pages/chat/queryChat/useHistoryMessageList.tsx`
  - `src/pages/common/ChooseModal/ChooseBox/index.tsx`
  - `src/pages/common/RtcCallModal/index.tsx`
  - `src/pages/common/RtcCallModal/RtcControl.tsx`
  - `src/pages/common/RtcCallModal/RtcLayout.tsx`
  - `src/pages/common/UserCardModal/index.tsx`
  - `src/store/contact.ts`
  - `src/store/type.d.ts`
  - `src/utils/messageExporter.ts`

## Known Limits

- Runtime Dock still has no PTY.
- Runtime Dock still has no xterm.js.
- Runtime Dock still does not launch Codex, opencode, OpenHands, shell, or PowerShell.
- Runtime Dock state is local browser state only.
- Full lint passes but retains existing warnings.
- Test users were created in the local OpenIM backend.

## Next Phase

Recommended branch from current `UI-feature`:

```bash
git checkout -b feature/runtime-dock-terminal
```

Phase 2 should be `Runtime Dock Terminal Surface`:

- Add a frontend-only terminal surface inside each runtime attachment.
- Keep transcript state keyed by `RuntimeAttachment.id`.
- Support local input and transcript append on Enter.
- Keep output mocked.
- Keep per-conversation attachment isolation.
- Do not add PTY, WebSocket, node-pty, Codex/opencode/OpenHands launch, API keys, or model/provider config yet.

Phase 3 should add PTY bridge only after Phase 2 terminal UI is stable.
