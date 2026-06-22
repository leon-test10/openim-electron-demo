# Session Handoff - Runtime Dock + opencode-local Smoke

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
