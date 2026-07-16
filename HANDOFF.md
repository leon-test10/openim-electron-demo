# Session Handoff - Contact-scoped Persistent Agent Sessions

## Latest Update - Agent Model, Message Dedup, and IM Delivery (2026-07-16)

### Fixed

- Agent sessions now load the connected provider/model catalog from OpenCode's
  `/config/providers` endpoint. The panel exposes a searchable per-session model
  selector and persists the selected `providerID/modelID`.
- Every new OpenCode prompt explicitly carries the selected model instead of
  silently falling through to an unsuitable global default.
- Optimistic `local_*` user messages are reconciled one-for-one with the
  corresponding OpenCode `msg_*` user message by text and creation time. This
  removes the duplicate user cards while retaining genuinely queued messages.
- Assistant message actions are always visible. `Insert to IM` still prepares a
  draft; `Send to IM` shows a confirmation dialog and then sends to the bound,
  currently visible IM conversation.
- Confirmed Agent replies sent in offline mode now use the local/self sender,
  rather than the legacy simulated peer sender.
- Fully automatic Agent-to-IM delivery remains disabled. Bot auto mode runs the
  Agent request but does not send its result without user confirmation.

### Validation

- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd test`: pass, including new optimistic/runtime message reconciliation
  coverage.
- `npm.cmd run lint -- --quiet`: pass.
- `npm.cmd run build:renderer`: pass.
- `agent-sessions.spec.ts`: pass, including model selection and confirmed IM
  delivery.

---

## Latest Update - Chat Layout Regression Fix (2026-07-16)

The nested horizontal Agent split and vertical Terminal/chat splits could
collapse the center IM message panel while leaving only the composer/send
controls visible.

### Fixed

- Propagated `h-full`, `min-h-0`, `min-w-0`, and overflow constraints through
  the chat layout and every nested resizable panel.
- Gave the IM message panel an explicit 75% default and 35% minimum share, and
  prevented the Agent/Terminal panels from shrinking the chat below a usable
  size.
- Removed the duplicate `chat-main` DOM id from the resizable panel wrapper.
- Made the editor body the flexible region inside the footer while keeping the
  action bar and Send button fixed.
- Added an offline Electron regression assertion that the message surface is
  visible, taller than the composer, and remains usable with the Agent panel
  open.

### Validation

- `npm.cmd run lint -- --no-fix`: pass with existing warnings only.
- `npm.cmd run build:renderer`: pass.
- `offline-im.spec.ts`: pass (1/1).
- Live Electron visual smoke test: message list retains the primary center
  area and the composer stays at the bottom.

---

## Latest Update - Offline Agent Runtime Hotfix (2026-07-16)

Current branch: `feature/agent-run-contract`

This hotfix was driven by a real offline-mode smoke test on Electron 22 and
Windows. Agent sessions can now start without a separately launched OpenCode
service, and the right panel always exposes a visible conversation surface.

### Fixed

- Added a single-flight guard around OpenCode service discovery/startup so
  concurrent persisted-session recovery cannot overwrite the shared binding or
  return an undefined `baseUrl`.
- Launches the configured OpenCode executable directly (`shell: false`), which
  supports the bundled executable path under `%APPDATA%` safely.
- Added `undici` as the Electron 22/Node 16 HTTP implementation. Health checks,
  Session API calls, and global SSE no longer depend on unavailable global
  `fetch`.
- SSE reconnect attempts now use per-attempt abort controllers and stop when an
  owned service exits, preventing accumulated abort listeners during outages.
- Removed the optional locally generated `messageID` from `prompt_async`;
  OpenCode now generates its required `msg*` identifier.
- Serialized JSON snapshot writes by target path and uses unique temporary plus
  backup files, avoiding Windows `ENOENT`/`EPERM` collisions while updating
  `.openim-agent/bridge.json` and message metadata.
- The Agent panel now renders an empty conversation state even with zero
  messages, shows actionable runtime errors and retry controls, restores draft
  text after send failure, and displays OpenCode model retry reasons.

### Smoke Test Result

- Application-owned OpenCode `1.17.12` started on `127.0.0.1:4096` and passed
  `/global/health`.
- A failed persisted session was recovered into the same workspace and became
  `idle`.
- System and user messages rendered as structured conversation cards.
- `prompt_async` accepted the user message after removing the invalid local ID.
- The configured model backend `http://10.96.248.17:8000/v1` currently returns
  HTTP 502 / closed-socket retries. The UI now reports this as a model retry;
  it is external to the Electron/OpenCode session transport hotfix.

### Validation

- `npm.cmd test`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npm.cmd run build:renderer`: pass.
- `agent-sessions.spec.ts`: pass.

---

## Latest Update - Persistent Agent Workspace Milestone (2026-07-11)

Current branch: `feature/agent-run-contract`

This milestone replaces the global Terminal Dock automation contract with a
contact-scoped Agent workspace. The Electron main process owns session and
runtime lifecycle, so changing contacts or hiding panels does not stop work.

### Implemented

- Added a persistent global `AgentSessionManager` with per-contact last-session
  selection, FIFO turns, independent concurrent sessions, unread aggregation,
  archive/pin/rename/recover actions, and atomic message snapshots under each
  workspace's `.openim-agent/` directory.
- Added `AgentRuntimeAdapter` and the OpenCode implementation. One reusable
  local `opencode serve` process supplies Session HTTP APIs and global SSE;
  only a service started by this app is stopped on true application exit.
- Added structured Agent message rendering, safe Markdown, interaction cards,
  IM insertion/attachment actions, resizable Agent and terminal panels, and a
  session-attached `opencode attach` PTY with main-process ring buffering.
- Contact switching immediately selects that contact's last Agent session and
  terminal target. Other sessions remain active and notify on completion,
  failure, or required interaction.
- Moved Bot detection into the global bridge with persisted client-message
  checkpoints and deduplication. `review` is the default, offline backfill never
  auto-runs, and each conversation reuses one Bot Agent session.
- Added auditable IM context snapshots and a token-scoped, localhost-only,
  read-only `openim_history` bridge. Tokens bind a runtime session to exactly
  one IM conversation and are revoked when live history is disabled.
- Added recovery behavior for missing OpenCode sessions without replaying old
  prompts. Auto-approve remains per-process and replies with `once` only.
- Removed active-chat Bot scanning from `ChatContent`; legacy Terminal Dock
  auto-inject/auto-reply E2E contracts are explicitly skipped because the new
  global router and confirmation-only Agent-to-IM flow supersede them.

### Primary Files

- Main lifecycle: `electron/main/agentSessionManage.ts`,
  `electron/main/opencodeManage.ts`, `electron/main/agentRuntimeAdapter.ts`
- History capability: `electron/main/agentHistoryCapability.ts`,
  `src/layout/useAgentSessionBridge.ts`
- Renderer state/UI: `src/store/agentSessions.ts`,
  `src/components/AgentPanel/`, `src/components/AgentTerminalPanel/`
- Shared contracts: `src/types/agentSession.ts`,
  `src/services/agentSessions/`
- Current Electron contract: `e2e/electron/specs/agent-sessions.spec.ts`

### Operational Notes

- OpenCode is the only complete runtime adapter in v1.
- A true app quit aborts in-flight sessions owned by the app and stops the
  app-owned OpenCode service. Restart restores IDs and messages but never
  replays interrupted prompts.
- Archiving hides a session and preserves its workspace and OpenCode history.
- Agent output is never automatically sent to IM; the user must insert or
  attach it and confirm sending.
- Legacy keys `openim_terminal_dock_state` and `openim_runtime_dock_state` are
  removed once when the new bridge initializes; existing workspace files are
  left untouched.

### Validation

- `npm.cmd test`: pass.
- Renderer and Electron-main TypeScript checks: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npm.cmd run build:renderer`: pass.
- Focused Electron Agent session E2E: pass.
- Electron E2E passed by current suite: Agent sessions (1), file/image/folder
  UX (5), history drawer (3), message selection (5), and structured output (5).
- A single-process aggregate run and the standalone `offline-im.spec.ts` exit
  with Playwright status 1 but report no failed test IDs. They leave orphaned
  test OpenCode processes after the runner aborts; this is recorded as test
  infrastructure follow-up rather than a product assertion failure.

### Follow-up Risk Areas

- Exercise notification-click navigation and real permission/question cards
  against a packaged OpenCode binary on Windows before release signing.
- Run a long-lived soak test with several simultaneous sessions and forced SSE
  disconnects; unit coverage validates reconnection/state transitions but does
  not replace an overnight runtime soak.
- Other runtimes must implement `AgentRuntimeAdapter`; no compatibility shim is
  provided by this milestone.

---

# Previous Handoff - Terminal Dock Redesign

## Latest Update - P11.7 Folder Share Download Folder (2026-06-29)

Current branch: `feature/agent-run-contract`

P11.7 adds whole-folder download for received `openim-agent.folder-share`
CustomMessages. It only touches folder-share download behavior; Auto File
Attach, context message counts, bot trigger behavior, and normal FileMessage
download behavior remain out of scope.

### Implemented

- `FolderMessageRender` now shows a `Download Folder` entry on the folder card
  and uses the same action from the folder viewer.
- New Electron IPC: `folder:downloadShare`.
- Renderer passes the folder-share manifest to the main process.
- Main process asks the user to choose a destination directory, creates
  `targetRoot / folderName`, and restores `manifest.files[].relativePath`.
- Empty folder shares create the destination folder even when there are no
  files.
- Downloads stream through the existing HTTP(S) downloader instead of loading
  whole files into renderer memory.
- Download summary reports `successCount`, `failedCount`, and `failedFiles`.
- Missing `sourceUrl`, unsupported URL schemes, and unsafe relative paths are
  recorded as per-file failures instead of crashing the entire folder download.
- Path traversal is blocked: absolute paths, `..` segments, and final paths
  outside the selected folder root are rejected.

### Manual Validation

1. Open a folder-share message.
2. Click `Download Folder`.
3. Pick a destination directory in the native dialog.
4. Confirm the app creates `<destination>/<folderName>/`.
5. Confirm nested paths such as `sub/deep/c.json` are restored under that
   folder.
6. For manifests with bad files, confirm the toast reports partial failures and
   the console logs `failedFiles`.
7. Cancel the directory picker and confirm there is no error toast.

### Validation

- `npm.cmd run build`: pass.
- `npm.cmd test`: pass.
- `npm.cmd run test:e2e -- e2e/electron/specs/file-image-ux.spec.ts`: 5 passed.

## Latest Update - P11.6 Folder Send Without Chat Flooding (2026-06-28)

Current branch: `feature/agent-run-contract`

P11.6 implements Plan B folder sharing semantics: a folder is sent as one
FolderShare custom message, not as a zip card and not as many FileMessages.

### Implemented

- `file:selectFolder` opens the native directory picker.
- `folder:scan` scans either a workspace-relative output folder or a selected
  native folder.
- Folder scanning enforces limits (`300` files, `200MB`) and skips `.git`,
  `node_modules`, and hidden entries except `.env`.
- Folder resource upload uses the OpenIM SDK `uploadFile` API directly, without
  sending per-file chat messages.
- `FolderShareManifest` stores only relative paths, file names, sizes,
  optional MIME types, `sourceUrl`, and `uuid`; local absolute paths are not
  written to the sent manifest.
- Sending a folder creates one `openim-agent.folder-share` CustomMessage.
- `FolderMessageRender` displays one folder card with folder icon, folder name,
  file count, total size, and `打开文件夹`.
- Folder viewer lists original relative file paths and supports opening local
  cached files, downloading one file, and downloading all files into a restored
  folder under Downloads.
- Folder output listed under `## Output Folders` is recognized; directory
  entries listed under `## Output Files` are also recognized for compatibility.
- `Final Answer Preview` was removed from TerminalDock.
- Folder E2E coverage verifies picker scan, no final-answer preview, folder
  pending kind, single folder card rendering, no zip fallback, no add-to UI, no
  local absolute paths in the viewer, and single/all-file download actions.

### Not Implemented

- Add-to feature.
- Cloud drive integration.
- Workspace import from received folder shares.
- Zip fallback UI.
- Sending N FileMessages for a folder.

### Validation

- `npm.cmd run lint -- --quiet`: pass.
- `npm.cmd run build`: pass.
- `npx.cmd playwright test -c playwright.electron.config.ts e2e/electron/specs/file-image-ux.spec.ts`: 5 passed.

## Latest Update — Remove PendingAgentRequests Card + @mention Autocomplete + Safety (2026-06-26)

Current branch: `feature/agent-run-contract`

### Removed: PendingAgentRequests Card

The pending agent request card UI (`PendingAgentRequests.tsx`) has been removed. Detection and store logic remain intact. The UX now relies on:

- **Auto Inject toggle** — when ON, targeted @bot messages auto-inject into terminal
- **Pending count badge** — `terminal-pending-agent-count` in TerminalDock shows count when auto-inject is off but workspace isn't linked
- **Automation bar buttons** — "Use @bot@nickname" helper + Auto Inject/Auto Reply toggles

### Added: @mention Autocomplete

Typing `@bot @` in the chat input shows a filtered candidate popover with keyboard navigation (↑↓/Tab/Enter/Escape) and click selection. Only users in the current conversation (self + conversation members) appear as candidates.

### Safety: No Raw Regex Fallback

`extractUserMention` removed. Targets only resolve from the candidate list — impossible to target users outside the current conversation.

---

## Latest Update - P11.1 Targeted @bot UX + Automation Verification (2026-06-26)

Current branch: `feature/agent-run-contract`

P11.1 tightens the user-facing trigger semantics and removes the misleading
debug-first workflow.

### Implemented

- `@bot` now requires an explicit target mention. Bare `@bot ...` is ignored.
- A user can trigger their own local agent only with a targeted prefix such as
  `@bot @<my nickname> ...` or `@bot @<my userID> ...`.
- Compact input such as `@bot@<nickname> ...` is supported when the nickname or
  userID resolves uniquely in the local candidate set.
- Self-sent targeted messages are allowed, so a user can intentionally trigger
  their own local agent from the IM input.
- The IM input automation bar now exposes a helper button that inserts the
  correct self-targeting prefix.
- The large Reply Debug Tools entry point was removed from the Terminal Dock
  primary toolbar. `Capture Final` is now directly available as the normal
  Agent -> IM action.
- The unreachable Reply Tools modal and user-visible OpenCode same-session
  probe UI were removed from Terminal Dock.
- `Advanced / Debug Context Files` was renamed to `Context Files`; it remains
  the place to inspect/export workspace context bundles and manage context-file
  history.
- Command Templates remain editable and local-only.
- Added a local-only `Agent Prompt Template` editor inside Command Templates.
  It supports `{runID}`, `{runDir}`, `{requestPath}`, `{finalAnswerPath}`,
  `{manifestPath}`, `{finalAnswerSkill}`, and `{contextSkill}` placeholders.
  Only the current template is stored; no prompt-template history is kept.
- E2E harness now resets the agent prompt template to the default on mount so
  test runs do not inherit a prior local template.

### Current Reality

- If logged in as `Codex Test 2`, sending `@bot@Codex Peer ...` should not
  trigger the `Codex Test 2` local agent. That message targets Codex Peer and
  should be processed by a Codex Peer client/session.
- Auto Reply still does not parse arbitrary native TUI screen text. It sends
  only validated run-file results or structured `final_answer` events matching
  the active run.
- For native `opencode` TUI, reliable automation requires the agent to obey the
  injected OpenIM skill contract and write the current run's
  `.agent/runs/<runID>/final_answer.md` plus completed `manifest.json`.

### Validation

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass.
- `npm.cmd run test:e2e -- e2e/electron/specs/bot-trigger.spec.ts e2e/electron/specs/terminal-dock.spec.ts --workers=1 --reporter=list --timeout=90000`: 25 passed.
- Targeted Electron E2E passed:
  - `bare @bot and agent-generated messages do not create pending requests`
  - `self-sent @bot targeted at own nickname can inject own agent`
  - `compact @bot@nickname resolves a unique local target`
  - `auto-reply requires structured final_answer to match active run`
  - `chat input exposes a self-targeting bot mention helper`
  - `agent prompt template can be edited without keeping prompt history`
  - Terminal Dock smoke verifies no Reply Debug/OpenCode probe controls are
    visible in the primary UI
  - structured output suite for watcher and Tier 1 final_answer capture
  - run-scoped final answer contract/capture/auto-reply tests
  - `bot-trigger.spec.ts` + `terminal-dock.spec.ts`: 25 passed

## Latest Update - P11 OpenIM Agent Skill Pack + Run-Scoped Final Answer (2026-06-26)

Current branch: `feature/agent-run-contract`

P11 replaces the old "hope the runtime emits a final answer" path with a
run-scoped OpenIM file contract. It is still runtime-neutral: OpenIM does not
own opencode/codex/claude sessions, prompts, memory, tools, model config, or
API keys.

### Implemented

- Added `src/services/agentRunContract/`:
  - creates unique `runID` values;
  - writes `.agent/skills/openim-final-answer.md`;
  - writes `.agent/skills/openim-context.md`;
  - creates `.agent/runs/<runID>/request.md`;
  - creates `.agent/runs/<runID>/manifest.json`;
  - records `.agent/latest-run.json` for diagnostics only.
- `Send to Agent` and Auto Inject now create an active run contract before
  writing to the terminal.
- The injected terminal prompt now tells the runtime to:
  - read `.agent/runs/<runID>/request.md`;
  - overwrite `.agent/runs/<runID>/final_answer.md`;
  - overwrite `.agent/runs/<runID>/manifest.json` with `status: "completed"`.
- `AgentOutputResolver` now supports source `run_file` and validates:
  - manifest `runID` matches the active run;
  - `status === "completed"`;
  - `finalAnswerPath` is exactly the current run final answer path;
  - `updatedAt` is later than the run creation time;
  - the resolved path stays inside `.agent/runs/<runID>/`.
- Terminal Dock Auto Receive / Auto Reply now prefer the active run file result.
- Auto Reply only accepts:
  - validated `run_file`; or
  - structured `final_answer` events tagged with the current active `runID`.
- Untagged structured `final_answer` events remain usable for manual capture but
  do not auto-send.
- E2E harness file mocks now support reading previously written workspace files,
  so tests can simulate runtime-written `manifest.json` and `final_answer.md`.

### Current Reality

- This is an OpenIM file-style skill contract, not a native opencode skill,
  Codex skill, Claude plugin, or ACP integration.
- Plain native `opencode` / `npx.cmd -y opencode-ai@1.17.9` TUI will not
  reliably produce a final answer unless it follows the injected instruction or
  is launched through a future wrapper.
- The intended next step is a runtime-specific wrapper, for example
  `openim-agent opencode`, that starts the runtime and guarantees this file
  contract is obeyed.

### Validation

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass.
- Targeted Electron E2E passed:
  - `send to agent creates run-scoped final answer contract`
  - `run-scoped final answer capture reads completed manifest`
  - `auto-reply sends only the active run completed final answer`
  - `auto-reply requires structured final_answer to match active run`
  - `auto-reply dedupes per session but allows same text from a new session`

### Not Implemented

- Native runtime skill/plugin installation.
- A guaranteed final answer from an arbitrary TUI that ignores the file
  contract.
- Default Auto Reply enablement.
- Expanding `@bot` automation scope.
- Runtime-specific wrapper commands such as `openim-agent opencode`.

## Latest Update - P10.1 Automation UX Containment (2026-06-26)

Current branch: `feature/p10-safety-opencode-same-session`

P10.1 tightens the UX around bot automation and final-answer capture after real
UI review. It does not expand runtime ownership.

### Implemented

- Moved the daily Auto Inject / Auto Reply controls out of the Terminal Dock
  Debug modal and into the IM input area above the editor.
- Enabling Auto Inject still requires confirmation and now also enables Bot
  Requests detection, so users do not need to discover a separate terminal-side
  switch first.
- Auto Reply remains explicit and confirmation-gated. It still only sends
  structured `final_answer` events for the active, linked workspace/conversation.
- `Reply Debug Tools` was renamed to `Reply Tools` and reduced to reply/capture
  controls.
- Structured sidecar status and OpenCode same-session server/probe controls are
  now hidden under `Developer diagnostics`, because they are implementation
  diagnostics rather than the normal runtime UX.
- The UI continues to make degraded OpenCode probing explicit. Native OpenCode
  TUI output is not presented as a reliable final answer unless a structured
  sidecar event or a bound same-session source exists.

### Validation

- `git diff --check` passed.
- `npm.cmd run lint -- --quiet` passed.
- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run build` passed.
- Targeted Electron E2E passed:
  - `auto-inject skips pending review and sends directly to terminal`
  - `auto-reply sends structured final_answer to IM`
  - `terminal dock smoke is available without a real runtime`
  - `unsafe automation defaults reset and stay in experimental debug UI`
  - `opencode probe degraded does not pretend to have final answer`
  - `opencode bound probe shows agent reply card and inserts only draft`

### Current Reality

- `@bot @targetUserID ...` is verified in E2E with the OpenIM harness.
- Structured `final_answer` auto-reply is verified in E2E by emitting a structured
  event into the active workspace.
- Native `npx.cmd -y opencode-ai@1.17.9` TUI output still does not automatically
  become a structured final answer by itself. For reliable automation, the
  runtime needs a sidecar writer, wrapper, or proven same-session API.

## Latest Update - P10.0 Safety Containment + OpenCode Same-Session Probe (2026-06-25)

Current branch: `feature/p10-safety-opencode-same-session`

P10.0 is implemented as a safety containment and probe layer, not as a broader
automation expansion.

### Implemented

- Unsafe automation defaults are reset to `false` on startup/reload:
  - `autoReceiveEnabled`
  - `autoSendEnabled`
  - `autoInjectEnabled`
  - `autoReplyEnabled`
- Auto Inject and Auto Reply were removed from the primary Terminal Dock toolbar
  and moved into `Reply Debug Tools -> Experimental Bot Automation`.
- Enabling Auto Inject or Auto Reply now requires an explicit risk confirmation.
- Auto Inject now requires:
  - a matching `@bot @targetUserID` trigger,
  - non-self and non-agent-generated message,
  - a running active terminal tab,
  - an explicit workspace/conversation binding.
    Otherwise it leaves the request in pending review.
- Auto Reply now requires:
  - `autoReplyEnabled`,
  - a running active tab in the active workspace,
  - current conversation still active,
  - current conversation linked to the active workspace,
  - a structured `final_answer` event from `.agent/events.ndjson`.
    It does not auto-send raw/screen fallback text.
- Manual `Capture Final Answer` now accepts only structured sources
  (`structured` or `structured_heuristic`). Raw terminal text and xterm screen
  capture are no longer treated as final answers.
- Structured Sidecar debug status was added:
  - watch state,
  - sidecar path explanation,
  - last event type,
  - last final_answer availability.
- Runtime connector scaffolding was added under
  `src/services/runtimeConnectors/`:
  - `RuntimeSessionBinding`
  - OpenCode server client/probe helpers
  - session message parsing and assistant-message extraction.
- Electron main now exposes conservative OpenCode IPC:
  - `opencode:probeServer`
  - `opencode:startServer`
  - `opencode:stopServer`
  - `opencode:getBinding`
- OpenCode server start is localhost-only:
  - command: `npx.cmd -y opencode-ai@1.17.9 serve --port 4096 --hostname 127.0.0.1`
  - no `0.0.0.0` exposure.
- OpenCode Same-Session Probe reports:
  - `shared-server-session` + `bound` only when server/session/messages are
    readable and an assistant message can be extracted,
  - degraded/failed otherwise.
- Agent Reply Card is shown only for a bound shared OpenCode session and only
  inserts to the IM input; it does not auto-send.

### OpenCode same-session probe result

Status: partial.

The app can now probe a localhost OpenCode server and present a binding result.
If the probe fails or no shared session messages are readable, the current mode
is `tui-only` or degraded and the UI explicitly says:

`No structured final answer available from current TUI session. Use Terminal Selection as Reply.`

Native OpenCode TUI is still not assumed to produce `.agent/events.ndjson` or to
share a readable session. That must be proven per local OpenCode installation.

### Not implemented

- Auto Reply default enable.
- Auto Inject default enable.
- Guaranteed final_answer extraction from native OpenCode TUI.
- Treating xterm screen capture as a final answer.
- Making `opencode run --format json` the default Send to Agent path.
- Codex connector.
- Claude Code connector.
- ACP client.

### Validation

- `npm.cmd run lint -- --quiet`: pass
- `npx.cmd tsc --noEmit`: pass
- `npm.cmd run build`: pass
- Targeted E2E:
  `$env:VITE_DEV_SERVER_URL=''; npx.cmd playwright test -c playwright.electron.config.ts e2e/electron/specs/terminal-dock.spec.ts e2e/electron/specs/bot-trigger.spec.ts`
  Result: 20 passed
- Full Electron E2E:
  `$env:VITE_DEV_SERVER_URL=''; npx.cmd playwright test -c playwright.electron.config.ts`
  Result: 33 passed

---

## Latest Update - Phase 1/2 Stabilization Fixes Verified (2026-06-25)

Current branch: `feature/p9-bot-trigger-detection`

This pass audited and hardened the Phase 1 structured-output channel and Phase 2
`@bot @user` automation work.

### Fixed

- Hardened `electron/main/agentWatchManage.ts`:
  - `agent:startWatch` now succeeds even when `.agent/events.ndjson` does not
    exist yet.
  - Watches the `.agent` directory and attaches the file watcher when the
    NDJSON file appears later.
  - Handles file truncation/rewrite by resetting the read offset.
  - Keeps malformed/partial lines from crashing the watcher.
- Added non-persisted auto-inject dedupe state in `TerminalDockStore`:
  - Tracks handled `conversationID|triggerMessageID` keys for the current app
    run.
  - Prevents repeated message scans/toggle cycles from injecting the same bot
    trigger again.
- Improved auto-reply dedupe:
  - Processes all structured `final_answer` events in a batch, not just the last
    one.
  - Dedupes by workspace + conversation + session/text key so identical text
    from a new session can still be sent once.
- Updated E2E harness coverage so mock workspace file writes to
  `.agent/events.ndjson` exercise the same structured-event path.

### Validation

- `git diff --check`: pass
- `npm.cmd run lint -- --quiet`: pass
- `npx.cmd tsc --noEmit`: pass
- `npm.cmd run build`: pass
- `$env:VITE_DEV_SERVER_URL=''; npx.cmd playwright test -c playwright.electron.config.ts`: pass, **28 passed**

### Current limits

- The reliable `final_answer` path requires a runtime or adapter to write
  structured NDJSON events to `.agent/events.ndjson`.
- Plain opencode TUI text is still only a fallback screen/raw capture source
  unless wrapped by a structured adapter.
- Auto Inject and Auto Reply remain opt-in toggles and safety-reset to off on
  reload.

---

## Latest Update - Phase 2: @bot @user Auto-Inject & Auto-Reply Complete (2026-06-25)

Current branch: `feature/p9-bot-trigger-detection`

Phase 2 of the roadmap is implemented and verified.

### Completed

**2.1 Trigger format: `@bot @targetUserID`** (`detectBotTrigger.ts`):

- New format: `@bot @targetUserID instruction` (or `/bot @targetUserID instruction`)
- Extracts `targetUserID` via `@mention` regex after the bot alias
- In group chats, strips leading `@currentUserID` mention first
- Single chat: `@bot @selfUserID do something` — calls own terminal
- Group chat: `@bot @memberUserID task` — calls that member's terminal (if they're logged in)
- Backward compatible: if no `@targetUserID` is specified, the request is still created

**2.2 Types** (`types.ts`):

- `BotTriggerResult.targetUserID?: string`
- `PendingAgentRequest.targetUserID?: string`
- Passed through `createPendingAgentRequest`

**2.3 Auto-Inject toggle** (TerminalDock "IM → Agent" toolbar):

- `autoInjectEnabled` — persisted to localStorage (safety-reset to false on reload)
- When ON: `@bot @selfUserID` messages auto-inject into terminal (skip pending review)
- When OFF: normal pending request flow with manual "Send to Agent" button
- Toggle is in the "IM → Agent" group alongside "Bot Requests"

**2.4 Auto-Reply toggle** (TerminalDock "Agent → IM" toolbar):

- `autoReplyEnabled` — persisted to localStorage (safety-reset to false on reload)
- When ON: structured `final_answer` events auto-send to the current IM conversation
- Deduplication via text hash (won't re-send the same answer)
- Uses Phase 1's `agent:structuredOutput` IPC channel

**2.5 ChatContent detection logic**:

- Filters by `targetUserID === selfUserID` (only process messages targeting ME)
- When `autoInjectEnabled`: creates request with `status: "sent"`, emits `BOT_AGENT_REQUEST_ACTION` immediately
- `promoteToAutoInject` effect: when auto-inject is toggled ON after detection, promotes existing pending requests to sent

**2.6 Store**:

- `autoInjectEnabled`/`autoReplyEnabled` in `TerminalDockStore` (persisted)
- `promoteToAutoInject(conversationID)` in `PendingAgentRequestStore`
- `addStructuredEvent`/`clearStructuredEvents` actions

**2.7 E2E tests** (`bot-trigger.spec.ts`):

- Updated all 4 existing tests for new `@bot @e2e_self` format
- New: auto-inject skips pending review and sends directly to terminal
- New: auto-reply sends structured final_answer to IM
- Full E2E suite: **25 passed, 0 failed**

### @User mention display

OpenIM raw message text contains userIDs in `@mentions` (e.g., `@3297174239`). The UI renders these as nicknames via the contact store. So:

- Raw text: unique userID (e.g., `@e2e_self`)
- UI display: nickname (e.g., "E2E Self")
- Detection extracts the userID for comparison with `selfUserID`

### Files changed

- `src/services/botTrigger/detectBotTrigger.ts`
- `src/services/botTrigger/types.ts`
- `src/services/botTrigger/createPendingAgentRequest.ts`
- `src/components/TerminalDock/index.tsx`
- `src/pages/chat/queryChat/ChatContent.tsx`
- `src/store/terminalDock.ts`
- `src/store/type.d.ts`
- `src/store/pendingAgentRequests.ts`
- `src/pages/e2e/E2EHarness.tsx`
- `src/utils/e2eMockData.ts`
- `e2e/electron/specs/bot-trigger.spec.ts`

### Validation

- `npx.cmd tsc --noEmit`: pass
- `npm.cmd run lint -- --quiet`: pass
- `npm.cmd run build`: pass
- `npx.cmd playwright test -c playwright.electron.config.ts`: 25 passed

---

## Latest Update - Phase 1: Structured Agent Output Protocol Complete (2026-06-25)

Current branch: `feature/p9-bot-trigger-detection`

Phase 1 of the structured-output roadmap is implemented and verified.

### Completed

**1.1 Typed AgentOutputEvent definitions** (`src/services/agentOutput/types.ts`):

- `AgentProgressEvent` — progress during agent execution (stage, message, percent)
- `AgentFinalAnswerEvent` — final answer (text, format, sessionID)
- `AgentArtifactEvent` — file artifact (path, mime, size, label)
- `AgentErrorEvent` — error (message, code)
- `AgentSessionEvent` — session lifecycle (id, status, summary)
- `isAgentOutputEvent()` type guard
- `StructuredEventBuffer` type + `createStructuredEventBuffer()` factory

**1.2 NDJSON file protocol + Electron Main watcher** (`electron/main/agentWatchManage.ts`):

- Convention: agent writes events to `$WORKSPACE/.agent/events.ndjson` (one JSON object per line)
- `agentWatchManager.start(webContents, workspaceID)` — creates `.agent/` dir, starts `fs.watch` on events file
- `agentWatchManager.stop(workspaceID)` — tears down watcher
- `agentWatchManager.stopAll()` — cleanup on app quit
- New IPC channels: `agent:structuredOutput` (main→render push), `agent:startWatch`/`agent:stopWatch` (render→main invoke)

**1.3 Preload** — no changes needed; existing generic `subscribe()`/`ipcInvoke()` cover the new channels.

**1.4 Refactored AgentOutputResolver** (`src/services/agentOutput/AgentOutputResolver.ts`):

- Tier 1: `resolveFromStructuredEvents()` — consumes structured AgentOutputEvent[] from IPC (reliable)
- Tier 2: `resolveStructuredOutput()` — heuristic JSON scanning of raw PTY output (was "structured", now "structured_heuristic")
- Tier 3: raw terminal text
- Tier 4: visible xterm viewport text (last resort)
- Updated `AgentOutputSource` type: `"structured" | "structured_heuristic" | "raw" | "screen"`

**1.5 TerminalDock wiring** (`src/components/TerminalDock/index.tsx`):

- Subscribes to `agent:structuredOutput` IPC and adds events to store
- Starts `agent:startWatch` when a terminal tab starts running
- Stops `agent:stopWatch` on tab stop/cleanup
- `getResolvedFinalAnswer()` passes `structuredEvents` to the resolver

**1.6 Store** (`src/store/terminalDock.ts`, `src/store/type.d.ts`):

- `structuredEventsByWorkspace: Record<string, AgentOutputEvent[]>` (not persisted)
- `addStructuredEvent(workspaceID, event)` action
- `clearStructuredEvents(workspaceID)` action

**1.7 E2E tests** (`e2e/electron/specs/structured-output.spec.ts`):

- Harness active when terminal starts
- `agent:startWatch` invoked on terminal start
- Structured `final_answer` resolves as Tier 1 (overrides raw terminal garbage)
- Progress events do not resolve as final answer; error + final_answer resolves correctly
- Full E2E suite: **23 passed, 0 failed**

### Files changed

- `src/services/agentOutput/types.ts` (new)
- `src/services/agentOutput/AgentOutputResolver.ts` (refactored)
- `src/services/agentOutput/index.ts`
- `electron/main/agentWatchManage.ts` (new)
- `electron/main/ipcHandlerManage.ts`
- `electron/main/appManage.ts`
- `electron/constants/index.ts`
- `src/store/type.d.ts`
- `src/store/terminalDock.ts`
- `src/components/TerminalDock/index.tsx`
- `src/pages/e2e/E2EHarness.tsx`
- `e2e/electron/specs/structured-output.spec.ts` (new)
- `e2e/electron/specs/terminal-dock.spec.ts`

### Validation

- `npx.cmd tsc --noEmit`: pass
- `npm.cmd run lint -- --quiet`: pass
- `npm.cmd run build`: pass
- `npx.cmd playwright test -c playwright.electron.config.ts`: 23 passed

### Next: Phase 2 — @bot Auto-Inject to Terminal

Phase 1 provides the reliable structured data channel. Phase 2 can now:

1. Add `BotRoutingPolicy` ("off" | "manual" | "auto")
2. Auto-route `@bot`-triggered messages to terminal (skip `PendingAgentRequests` review when policy = "auto")
3. Create `BotSession` records to track lifecycle

---

## Latest Update - Structured Output & Auto-Feed Analysis (2026-06-25)

Current branch: `feature/p9-bot-trigger-detection`

### Context

The goal is twofold:

1. **Structured extraction of terminal output** — reliably capture agent results from the terminal so they can be automatically sent back to IM chat.
2. **IM-based @bot auto-feed into TUI** — when someone `@bot`s in chat, the message should automatically flow into the terminal agent without manual review.

### Current Architecture (as of `12cf91f`)

**Terminal → IM direction:**

```
node-pty (Electron Main)
  → IPC "terminal:event" (type:"stdout", raw PTY bytes)
  → outputByTab (TerminalOutputChunk[], in-memory, not persisted)
  → xterm.js rendering
  → AgentOutputResolver (heuristic: scan JSON lines → raw text → screen scrape)
  → captureTerminalFinalAnswer() → emit("REPLACE_CHAT_INPUT" / "SEND_CHAT_INPUT")
  → ChatFooter → OpenIM SDK send
```

**IM → Terminal direction:**

```
ChatContent scans messages
  → detectBotTrigger("@bot" / "/bot" prefix)
  → createPendingAgentRequest → store
  → PendingAgentRequests component (manual "Send to Agent" click)
  → emit("BOT_AGENT_REQUEST_ACTION")
  → TerminalDock → IMContextService.createContextBundle → writeToTab(prompt)
```

### Key Gaps

| Gap                          | Severity | Detail                                                                                                                                                                                                                             |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No structured output channel | Critical | All output arrives as raw PTY bytes. `AgentOutputResolver` is a heuristic JSON scanner — if the agent doesn't emit JSON, fallback is raw text or screen scraping. There is no dedicated structured IPC channel from Electron Main. |
| @bot auto-inject missing     | Critical | `@bot` detection works, but the flow stops at `PendingAgentRequests`. User must manually click "Send to Agent". No auto-routing.                                                                                                   |
| Auto-reply missing           | Critical | Terminal results cannot be automatically sent back to the IM conversation that triggered the bot.                                                                                                                                  |
| Output not persisted         | Medium   | `outputByTab` and `lastCapturedTextByTab` are in-memory only. Lost on reload.                                                                                                                                                      |
| No artifact detection        | Medium   | Agent-generated workspace files are not automatically detected or offered for IM attachment.                                                                                                                                       |
| No streaming progress        | Medium   | Only debounced 1200ms "final answer" capture exists. No incremental progress events to chat.                                                                                                                                       |
| No bot session concept       | Medium   | No lifecycle tracking of `@bot` → Agent → Reply interactions.                                                                                                                                                                      |

### Recommended Roadmap

#### Phase 1: Structured Agent Output Protocol (Foundation)

This is the critical prerequisite. Without a reliable structured channel, all downstream automation is fragile.

**1.1 Define typed Agent Output Events** (`src/services/agentOutput/types.ts`):

```ts
type AgentOutputEvent =
  | { type: "progress"; stage: string; message: string; percent?: number }
  | { type: "final_answer"; text: string; format: "markdown" | "text" | "json" }
  | { type: "artifact"; path: string; mime: string; size: number; label?: string }
  | { type: "error"; message: string; code?: string }
  | { type: "session"; id: string; status: "started" | "completed" | "failed" };
```

**1.2 File-based NDJSON protocol:**

- Convention: agent writes structured events to `$WORKSPACE/.agent/events.ndjson`
- opencode already supports `--format json`; we can redirect or tee structured output to this file
- Even in TUI mode, the agent can write a sidecar structured log

**1.3 Electron Main file watcher + new IPC channel:**

- `terminalManage.ts`: after workspace starts, `fs.watch` on `.agent/events.ndjson`
- New IPC channel: `agent:structuredOutput` — sends typed events to renderer
- Backward compatible: no file → fall back to current heuristic parsing

**1.4 Refactor AgentOutputResolver:**

- Tier 1: consume structured IPC events (reliable, type-safe)
- Tier 2: JSON scanning of PTY output (current heuristic, for agents without the protocol)
- Tier 3: raw/screen fallback (last resort)

**Files to create/modify:**

- `src/services/agentOutput/types.ts` (new)
- `src/services/agentOutput/AgentOutputResolver.ts` (refactor)
- `electron/main/terminalManage.ts` (add file watcher + IPC)
- `electron/constants/index.ts` (add `agent:structuredOutput` channel)
- `src/store/terminalDock.ts` (subscribe to new IPC)
- `src/components/TerminalDock/index.tsx` (consume structured events)

#### Phase 2: @bot Auto-Inject to Terminal

**2.1 Bot routing policy** (per-conversation setting):

```ts
type BotRoutingPolicy = "off" | "manual" | "auto";
```

**2.2 Auto-inject flow:**

- `@bot` detected + policy = `auto` → skip `PendingAgentRequests` review card
- Auto-call `IMContextService.createContextBundle` → `writeToTab(prompt)`
- Create `BotSession` record tracking this interaction

**2.3 Bot session lifecycle:**

```ts
interface BotSession {
  id: string;
  conversationID: string;
  triggerMessageID: string;
  status: "pending" | "processing" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  resultText?: string;
  artifacts?: string[];
}
```

**Files to create/modify:**

- `src/services/botTrigger/types.ts` (add BotSession, BotRoutingPolicy)
- `src/store/pendingAgentRequests.ts` (add auto-routing logic)
- `src/pages/chat/queryChat/ChatContent.tsx` (auto-inject path)
- `src/components/TerminalDock/index.tsx` (BotSession tracking)

#### Phase 3: Terminal Result Auto-Reply to IM

Depends on Phase 1 structured output.

**3.1 Auto-reply flow:**

- Agent emits `final_answer` via structured channel
- If `autoSendEnabled` + conversation has active `BotSession` → auto `emit("SEND_CHAT_INPUT", text)` back to the triggering conversation
- Include artifact references if agent generated files

**3.2 Streaming progress (optional):**

- Agent emits `progress` → optionally send status messages to IM ("Analyzing...", "Generating...")
- Configurable verbosity

**Files to create/modify:**

- `src/components/TerminalDock/index.tsx` (auto-reply on structured final_answer)
- `src/store/terminalDock.ts` (BotSession association)

#### Phase 4: Persistence & Artifact Management

**4.1 Terminal transcript persistence:**

- `outputByTab` periodically flushed to disk
- Restore on reload

**4.2 Artifact auto-detection:**

- Watch workspace for new files
- Auto-offer to attach to IM chat

**4.3 Bot Session history:**

- Persist bot sessions
- UI to review past bot interactions

### Not in Scope (Yet)

- True background bot (agent running without visible terminal)
- Multi-modal (image/voice) bot triggers
- Per-user/per-conversation bot alias configuration
- Agent API key/provider management (agent CLIs own their config)

---

## Latest Update - P9.1 Low-Token Stabilization

Current branch: `feature/p9-bot-trigger-detection`

Reason:

- We needed a lower-risk stabilization pass instead of widening scope again.
- `final answer` extraction needed a runtime-adapter shape so later auto-send
  is not tied only to fragile TUI scraping.
- Multi-select still behaved too much like a floating custom tool instead of an
  in-conversation DingTalk-like selection flow.

Scope completed:

- Added neutral agent-output resolver service:
  - `src/services/agentOutput/AgentOutputResolver.ts`
  - `src/services/agentOutput/index.ts`
- Final answer capture is now ordered as:
  1. structured machine-readable output parsed from PTY/raw output;
  2. raw/stored terminal output fallback;
  3. visible xterm screen fallback.
- Added first structured-path support for opencode-style JSON/event lines, so
  `assistant.final` / `final` / similar completion objects are preferred over
  visible-screen scraping when they exist.
- Terminal Dock now exposes `Capture Final Answer`, `Auto Receive Final Answer`,
  and `Auto Send Final Answer` semantics on top of the resolver.
- `Use Selection as Reply` is no longer treated as the primary extraction path;
  when live selection is unavailable inside a TUI, the UI now points users to
  final-answer capture instead.
- Added conversation-stream selection boundary UI:
  - new `MessageSelectionBoundary`
  - `Select below messages` / `Cancel select below messages`
  - anchor-aware selection state in `useMessageSelectionStore`
- The selected-message toolbar no longer owns the "select below" entry; it now
  only carries action buttons.
- Reduced the right terminal panel minimum size further so the chat side can be
  compressed more naturally during side-by-side work.
- Added stable test ids for pending draft attachments and removal, and extended
  the E2E harness so workspace-file pending attachments can be removed in tests.

Files changed in this pass:

- `src/services/agentOutput/*`
- `src/components/TerminalDock/index.tsx`
- `src/pages/chat/queryChat/MessageSelectionBoundary.tsx`
- `src/store/messageSelection.ts`
- `src/pages/chat/queryChat/ChatContent.tsx`
- `src/pages/chat/queryChat/MessageItem/index.tsx`
- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/chat/index.tsx`
- `src/pages/chat/queryChat/ChatFooter/index.tsx`
- `src/pages/e2e/E2EHarness.tsx`
- `e2e/electron/specs/message-selection.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`

Validation run:

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `$env:VITE_DEV_SERVER_URL=''; npx.cmd playwright test -c playwright.electron.config.ts e2e/electron/specs/message-selection.spec.ts e2e/electron/specs/terminal-dock.spec.ts e2e/electron/specs/history-drawer.spec.ts e2e/electron/specs/bot-trigger.spec.ts`: pass. Result: 19 passed.

Important semantics and limits:

- This pass does not add `@bot` auto-send, Auto Inject, Auto Reply, or broader
  runtime management.
- The new resolver prefers structured output, but generic arbitrary TUI screens
  still fall back to heuristic text capture when no machine-readable channel is
  available.
- For opencode specifically, `npx.cmd -y opencode-ai@1.17.9` exposes structured
  paths such as `opencode run --format json`, `serve`, and `export`; the live
  fullscreen TUI itself should not be assumed to emit stable JSON on screen.
- `VITE_DEV_SERVER_URL` must be cleared for reliable Electron E2E runs in this
  workspace, otherwise tests can accidentally target a stale dev server.

## Latest Update - P9.1 Selection Toolbar and Forwarding Hardening

Current branch: `feature/p9-bot-trigger-detection`

Reason:

- Real usage still showed the selected-message toolbar behaving like a cramped
  temporary pill rather than a DingTalk-like multi-select action bar.
- `Forward` was still a visual placeholder with no real send path.
- The chat/terminal split and conversation sider both had hard minimum widths,
  making the left chat area feel artificially locked.

Scope completed:

- Rebuilt `MessageSelectionToolbar` into a wider bottom floating action bar with
  no internal horizontal scrollbar.
- Primary selected-message actions are now:
  - `Forward`;
  - `Merge Forward`;
  - `Copy`;
  - `Delete`;
  - `Send to Agent`;
  - `More`;
  - `Clear`.
- Added real single-message and multi-message forward flow:
  - message action menu `Forward` is enabled;
  - selected-message `Forward` opens the existing choose-target modal;
  - selected-message `Merge Forward` sends a merger message built from the
    selected messages.
- Added a neutral forwarding state path with:
  - `src/store/messageForward.ts`;
  - `src/services/messageForward/index.ts`.
- `SELECT_USER` target selection now also works for forwarding, including group
  targets through `ChooseBox includeGroups`.
- Added local selected-message delete behavior:
  - OpenIM local message delete is called per selected message;
  - current chat history list removes the deleted rows immediately through the
    new `REMOVE_MESSAGES` event.
- Relaxed width constraints:
  - chat-vs-terminal outer split minimum reduced;
  - `FlexibleSider` minimum width reduced from `240px` to `180px`.

Files changed in this pass:

- `src/store/messageForward.ts`
- `src/store/index.ts`
- `src/store/type.d.ts`
- `src/services/messageForward/index.ts`
- `src/utils/events.ts`
- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/chat/queryChat/MessageItem/MessageActionMenu.tsx`
- `src/pages/chat/queryChat/useHistoryMessageList.tsx`
- `src/pages/common/ChooseModal/index.tsx`
- `src/pages/common/ChooseModal/ChooseBox/index.tsx`
- `src/pages/chat/index.tsx`
- `src/components/FlexibleSider/flexible-sider.module.scss`
- `src/i18n/resources/en.json`
- `src/i18n/resources/zh.json`
- `e2e/electron/specs/message-selection.spec.ts`

Validation run:

- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run lint -- --quiet`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e -- message-selection.spec.ts`: pass. Result: 5 passed.
- `npm.cmd run test:e2e`: pass. Result: 19 passed.

Important semantics and limits:

- Current `Delete` is implemented as local deletion from OpenIM local storage,
  not a server/global recall semantic.
- Generic opencode TUI output is still not treated as a reliable structured
  `final_answer` channel.
- For opencode specifically, a future runtime-specific adapter should prefer
  supported structured surfaces such as `opencode run --format json`,
  `opencode serve`, `opencode export`, or `opencode acp` instead of scraping the
  visible terminal screen.

## Latest Update - P9 Bot Trigger Detection and Pending Agent Requests

Current branch: `feature/p9-bot-trigger-detection`

Source branch: `feature/attachment-context-export`

Plan source:

- `C:\Users\leon\Desktop\# Plan P9 Bot Trigger Detection and.txt`
- `docs/terminal-bot-routing-spec-v0.md`

Scope completed:

- Added neutral bot-trigger detection service under `src/services/botTrigger/`.
- Supported text-only triggers:
  - `@bot`;
  - `/bot`.
- Added `usePendingAgentRequestStore` for pending agent handoff state.
- Bot detection is off by default and can be enabled explicitly from Terminal
  Dock via the `Bot Requests` switch.
- Incoming text messages are scanned only when detection is enabled.
- Detection skips:
  - self-sent messages;
  - messages marked with `ex.agent.generated_by`;
  - non-text messages.
- Pending requests are deduplicated by conversation and trigger message ID.
- Added `PendingAgentRequests` review cards in chat with explicit actions:
  - `Review`;
  - `Send to Agent`.
- Context bundle creation remains lazy: no markdown/manifest/prompt bundle is
  generated at detection time.
- Added `ContextSource.kind = "botTrigger"` and prompt/manifest/markdown source
  metadata for bot-trigger requests.
- Bot-trigger prompt includes the trigger message, message count, and safety
  instruction:
  `Do not send messages back to OpenIM by yourself.`
- Terminal Dock listens for explicit bot request actions and remains the only
  owner of workspace persistence, context history, clipboard, and terminal
  writes.
- Group-chat pending requests show an explicit review warning.
- E2E harness now supports single-chat and group-chat bot-trigger scenarios.

Files changed in this pass:

- `src/services/botTrigger/*`
- `src/store/pendingAgentRequests.ts`
- `src/store/index.ts`
- `src/utils/events.ts`
- `src/services/imContext/types.ts`
- `src/services/imContext/IMContextService.ts`
- `src/pages/chat/queryChat/ChatContent.tsx`
- `src/pages/chat/queryChat/PendingAgentRequests.tsx`
- `src/components/TerminalDock/index.tsx`
- `src/components/TerminalDock/terminalDock.css`
- `src/pages/e2e/E2EHarness.tsx`
- `src/utils/e2eMockData.ts`
- `e2e/electron/fixtures/mockOpenIM.ts`
- `e2e/electron/helpers/wait.ts`
- `e2e/electron/specs/bot-trigger.spec.ts`
- `e2e/electron/specs/history-drawer.spec.ts`

Validation run:

- `git diff --check`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass. Result: 18 passed.

Important semantics and limits:

- P9 adds pending request detection and manual review only.
- It does not implement Auto Inject.
- It does not implement Auto Reply.
- It does not automatically write IM messages into terminal.
- It does not automatically send terminal output back to IM.
- `Draft -> Chat (experimental)` remains separate, opt-in, and disabled by
  default.
- No runtime-specific API key/model/provider configuration was added.
- The terminal/agent CLI remains responsible for its own session, memory,
  permissions, tools, and resume behavior.

Recommended next implementation slice:

1. Add a better pending-request inbox/history so ignored/sent requests can be
   inspected per conversation.
2. Add configurable bot aliases only after deciding per-user/per-conversation
   policy.
3. Keep any Auto Inject or Auto Reply behavior behind a separate explicit
   safety plan and off by default.

## Latest Update - P9.1 Hardening Follow-up

Current branch: `feature/p9-bot-trigger-detection`

Reason:

- Real usage showed `Use Selection as Reply` could confirm successfully but not
  update the actual CKEditor input.
- `Attach Workspace File` produced a pending chip that could not be cancelled
  or sent.
- The selected-message toolbar could collapse into a tall side card when the
  Terminal Dock reduced the chat width.
- Generic `final_answer` extraction from arbitrary TUI output remains unreliable
  without runtime-specific adapters.

Scope completed:

- Made the CKEditor wrapper synchronize external `value` changes into the live
  editor via `setData`, so Terminal Dock reply insertion reaches the real input.
- Workspace files now attach directly to the reply draft without a custom
  confirmation modal.
- Pending workspace-file chips in ChatFooter now have a remove button.
- ChatFooter send now handles text plus pending workspace files, or file-only
  drafts, and sends them through OpenIM image/file message creation.
- Selected-message toolbar was rebuilt as a bottom floating horizontal action
  bar, closer to DingTalk-style multi-select actions and no longer a narrow
  sticky card in the message stream.
- Added E2E coverage to guard the selected toolbar against vertical/card
  regression and updated workspace-file attach expectations.

Validation run:

- `git diff --check`: pass.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass. Result: 19 passed.

Important semantics and limits:

- `Use Selection as Reply` still only drafts text; it does not auto-send.
- Workspace-file attachment sending uses explicit user send from ChatFooter.
- Generic terminal screen scraping is still not treated as reliable
  `final_answer` extraction.
- For opencode, prefer a future runtime-specific adapter based on supported
  structured surfaces such as `opencode run --format json`,
  `opencode serve`, `opencode export`, or `opencode acp`.
- `/bot` remains pending-only and manually reviewed before terminal handoff.

## Latest Update - P9.1 IM-Agent Product UX Cleanup

Current branch: `feature/p9-bot-trigger-detection`

Spec source: `.trae/specs/simplify-im-agent-ux/spec.md`

Scope completed:

**IM-native UX cleanup:**

- Multi-select toolbar now shows only `Copy`, `Forward`, `Send to Agent`, `More`, `Clear` as primary actions. No `Preview Selected Context`, `Copy Selected Prompt`, or `Copy Manifest` in the main row.
- `Send to Agent` directly writes selected-message context to the active terminal without opening the Context Library.
- All debug actions (`Preview Selected Context`, `Copy Selected Prompt`, `Export MD`, `Copy Manifest`, `Copy Full Path`) moved to `More -> Advanced / Debug`.
- Message right-click menu reordered with IM-native actions first: `Reply`, `Copy`, `Forward`, `Favorite`, `Multi-select`, `Translate`.
- `Send to Agent` in the right-click menu delegated to `More`. `Agent Prompt` / `Agent Context` / `Manifest` actions relegated to `More -> Advanced / Debug`.
- Image/file message menus show `View`, `Download`, `Forward`, `Favorite`, `Multi-select` as primary IM-native actions.

**Terminal UX simplification:**

- Terminal main toolbar reduced to `Run / Stop`, `Clear`, `Bot Requests`, `More`.
- `Send Last Context` and `Context Library` removed from primary toolbar.
- `Context Library` renamed to `Advanced / Debug Context Files` and accessible only from `More -> Advanced`.
- Context history records now show summary info (source kind, time, counts, status, paths) plus `Open` / `More`. `Send Again`, `Copy Prompt`, `Copy MD`, `Copy Manifest`, `Attach Manifest` moved into `More`.

**Agent -> IM safety:**

- `Selection -> Draft` renamed to `Use Selection as Reply`, now requires user confirmation before inserting into input box, and never auto-sends.
- `Capture Output -> Draft`, `Auto Capture Output -> Draft`, `Draft -> Chat experimental` demoted to debug tools under `More -> Advanced -> Reply Debug Tools`.
- `Auto Capture Output -> Draft` forced to off by default. localStorage migration resets it on startup if previously on.
- `Draft -> Chat experimental` kept off by default.
- Capture Output labeled as screen/output capture, not final answer.

**Bot Requests:**

- `Bot Requests` remains pending-only: `Review` and `Send to Agent` are the only visible actions.
- `@bot` / `/bot` detection only creates pending requests. No auto-send, no auto-reply.
- Group-chat requests continue to show review warning.

**E2E coverage:**

- Send to Agent directly writes to terminal without opening Context Library.
- Primary UI surfaces do not expose `Copy Prompt`, `Preview Context`, `Copy Manifest`, `Send Last Context`, or `Context Library`.
- Auto Capture and Draft -> Chat default off, terminal output does not auto-populate input box.
- Use Selection as Reply confirmed, inserted, not auto-sent.
- Advanced / Debug Context Files show record summaries and More menu actions.
- Bot-trigger pending request flow with manual Send to Agent.

Files changed in this pass:

- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/chat/queryChat/MessageItem/MessageActionMenu.tsx`
- `src/pages/chat/queryChat/PendingAgentRequests.tsx`
- `src/components/TerminalDock/index.tsx`
- `src/components/TerminalDock/WorkspaceBar.tsx`
- `src/components/TerminalDock/terminalDock.css`
- `src/store/terminalDock.ts`
- `e2e/electron/specs/message-selection.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`
- `e2e/electron/specs/bot-trigger.spec.ts`
- `HANDOFF.md`

Validation run:

- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass (existing AntD `"use client"` and chunk-size warnings).
- `npm.cmd run test:e2e`: 18 passed, 1 flaky (bot-trigger Electron startup timeout, not a logic regression).

Not implemented (explicitly excluded from P9.1):

- Auto Inject.
- Auto Reply.
- True background bot.
- Terminal final answer parser.
- Runtime event adapter.
- Automatic terminal output to IM sending.
- Full Forward / Favorite / Translate / Delete / Recall implementations (entries exist as disabled placeholders for IM-native menu shape).
- Multi-conversation context selector.
- Bot alias configuration.

## Latest Update - P7/P8 Stabilized Manual IM-Agent Handoff

Current branch: `feature/attachment-context-export`

Source inputs:

- `C:\Users\leon\Downloads\P7_P8_PLAN.md`
- `handoff_trae.md`
- `docs/terminal-bot-routing-spec-v0.md`

Scope completed:

- P7 IM -> Agent flow was tightened so selected/history/search/recent context
  actions create neutral `ContextBundle`s and keep Terminal Dock as the
  consumer/writer rather than the owner of IM context semantics.
- Selected-message actions now expose direct semantics:
  - `Send Selected to Terminal`
  - `Copy Selected Prompt`
  - `Preview Selected Context`
- Context preview is no longer the default path for send/copy actions. The
  Context modal is treated as `Context Library` for preview, history, reuse, and
  debugging.
- Context history records support record-scoped copy/send/path actions.
- Prompt/manifest/markdown now include source summary, source kind, message
  count, and attachment status summaries, including exported/referenced/failed/
  skipped/unsupported counts.
- Attachment export hardening was added:
  - safer workspace-relative target validation;
  - executable/script extension blocking for attachment export targets;
  - local source path checks for absolute path, UNC, symlink, file-only, and
    max-size constraints;
  - HTTP(S) download content-length guard;
  - per-attachment failure isolation so a failed attachment does not block the
    context bundle.
- P8 Terminal -> IM flow was renamed and bounded:
  - `Selection -> Draft`;
  - `Capture Output -> Draft`;
  - `Auto Capture Output -> Draft`;
  - `Draft -> Chat (experimental)` remains opt-in with warning and off by
    default.
- Terminal toolbar is grouped by direction:
  - runtime controls;
  - IM -> Agent;
  - Agent -> IM.
- Workspace file -> IM attachment MVP now uses explicit confirmation and adds a
  pending draft attachment event instead of directly sending IM messages.
- The E2E harness now exposes pending draft attachments and a deterministic
  terminal-output injection helper for Capture Output tests.

Files changed in this pass:

- `electron/main/workspaceManage.ts`
- `src/components/TerminalDock/index.tsx`
- `src/components/TerminalDock/terminalDock.css`
- `src/pages/chat/queryChat/ChatFooter/index.tsx`
- `src/pages/chat/queryChat/ChatFooter/SendActionBar/useFileMessage.ts`
- `src/pages/chat/queryChat/MessageHistoryDrawer.tsx`
- `src/pages/chat/queryChat/MessageItem/MessageActionMenu.tsx`
- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/e2e/E2EHarness.tsx`
- `src/services/imContext/IMContextService.ts`
- `src/services/imContext/attachments/export.ts`
- `src/services/imContext/types.ts`
- `src/store/terminalDock.ts`
- `src/store/type.d.ts`
- `src/utils/events.ts`
- `src/utils/e2eMockData.ts`
- `e2e/electron/fixtures/electronApp.ts`
- `e2e/electron/fixtures/mockOpenIM.ts`
- `e2e/electron/specs/history-drawer.spec.ts`
- `e2e/electron/specs/message-selection.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`

Validation run:

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass. Result: 14 passed.

Still intentionally not implemented:

- No `@bot` trigger handling.
- No Auto Inject.
- No Auto Reply.
- No new automated IM sending behavior beyond the existing explicitly enabled
  `Draft -> Chat (experimental)` switch.
- No terminal-output path auto-parser for attachments.
- No real OpenIM server/manual attachment validation was performed in this pass;
  this remains a follow-up with live accounts and real uploaded files.

## Latest Update - P7 Attachment Export and Manifest

Current branch: `feature/attachment-context-export`

Source branch: `feature/im-context-service`

Scope completed:

- Added attachment schema and helpers under `src/services/imContext/attachments/`.
- Added `ContextAttachment`, attachment kind/status/source types, stable
  `attachmentId`, `logicalUri`, safe file names, and workspace-relative
  attachment paths.
- Added defensive attachment extraction for OpenIM image, file, video, audio,
  and unsupported message types.
- Image/file/pdf/text attachments receive workspace-relative export targets.
- Video/audio are represented in manifest as skipped placeholders in this first
  P7 slice to avoid large automatic workspace exports.
- Added `exportContextAttachments` with per-attachment failure isolation.
- Local file copy is attempted first; if it fails and an HTTP(S) URL exists, the
  export falls back to download.
- Added Electron main IPC:
  - `workspace:copyWorkspaceFile`;
  - `workspace:downloadWorkspaceFile`.
- Workspace file export validates the destination remains inside the active
  terminal workspace and computes size plus SHA-256 for exported files.
- Manifest now includes a top-level `attachments` array and attachment IDs per
  message.
- Markdown now includes an `Attachments:` section under each relevant message,
  including status, path, logical URI, source URL, size, SHA-256, and errors.
- Prompt now tells the terminal agent to inspect markdown, manifest, and
  exported workspace-relative attachment paths.
- Terminal Dock context persistence now exports attachments before writing the
  final markdown/manifest files.
- Context History now stores and displays attachment/export/failure stats.
- E2E harness now includes mock image/file attachment messages and mock
  copy/download IPC behavior.
- Added E2E coverage for:
  - exported image attachment paths;
  - failed attachment export not blocking bundle creation;
  - Send Prompt to Terminal containing attachment/status guidance.

Files changed in this pass:

- `electron/constants/index.ts`
- `electron/main/ipcHandlerManage.ts`
- `electron/main/workspaceManage.ts`
- `src/services/imContext/attachments/*`
- `src/services/imContext/IMContextService.ts`
- `src/services/imContext/index.ts`
- `src/services/imContext/types.ts`
- `src/components/TerminalDock/index.tsx`
- `src/store/type.d.ts`
- `src/store/terminalDock.ts`
- `src/pages/e2e/E2EHarness.tsx`
- `src/utils/e2eMockData.ts`
- `e2e/electron/fixtures/mockOpenIM.ts`
- `e2e/electron/specs/history-drawer.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`

Validation run:

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass. Result: 11 passed.

Important semantics and limits:

- P7 was validated with mock/harness E2E only.
- Real OpenIM server attachment URL/local-cache behavior still requires manual
  or real-account validation.
- No `@bot` behavior was added.
- No Auto Inject behavior was added.
- No Auto Reply or automated IM sending behavior was added.
- No direct multimodal LLM API call was added.
- No runtime-specific attachment flags were added.
- No workspace-file-to-IM attachment send was added.
- No terminal output path auto-parse was added.
- `workspaceAbsolutePath` remains an in-memory export result; manifest output is
  path-first with workspace-relative paths.

Recommended next implementation slice:

1. Validate real OpenIM image/file messages against Docker/local accounts and
   confirm actual `sourcePath` / `filePath` / URL behavior.
2. Add optional `Open Attachments Folder` / `Copy Attachments Path` actions to
   Context History.
3. Add workspace-file-to-IM attachment sending only after explicit UX/safety
   planning.

## Latest Update - P6 Neutral IM Context Service

Current branch: `feature/im-context-service`

Source branch: `feature/terminal-dock-redesign`

Scope completed:

- Added neutral IM context service under `src/services/imContext/`.
- Defined shared `ContextSource`, `ContextBundle`, and `ContextAction` types.
- Supported context source kinds:
  - `recentMessages`;
  - `selectedMessages`;
  - `historyMessages`;
  - `searchResults`.
- Moved markdown, manifest, prompt, message formatting, and bundle generation
  logic out of the old utility path and into `IMContextService`.
- Kept `src/utils/imContextBuilder.ts` as a deprecated re-export shim for
  compatibility.
- Added neutral `IM_CONTEXT_ACTION` event.
- Kept `TERMINAL_CONTEXT_ACTION` as a deprecated compatibility alias.
- Updated selected-message toolbar, per-message action menu, and history drawer
  actions to emit `IM_CONTEXT_ACTION`.
- `MessageHistoryDrawer` now sends `historyMessages` for normal history
  selections and `searchResults` for search-result selections.
- Added History Drawer `Copy Prompt` and `Send Prompt` entries beside
  `Create Context`.
- Refactored `TerminalDock` so it consumes `ContextBundle` from the neutral
  service, while still owning terminal/workspace-specific responsibilities:
  workspace file writes, prompt copy, prompt send, and Context History.
- Recent-message context still starts from Terminal Dock UI, but bundle creation
  now also goes through `IMContextService`.
- Extended Electron E2E coverage for selected-message, history-message,
  search-result, and Terminal Dock context-history flows.
- Added an E2E-only Electron API mock in the hidden harness so terminal workspace
  flows can be tested without a real PTY/runtime process.

Files changed in this pass:

- `src/services/imContext/types.ts`
- `src/services/imContext/IMContextService.ts`
- `src/services/imContext/index.ts`
- `src/utils/imContextBuilder.ts`
- `src/utils/events.ts`
- `src/store/type.d.ts`
- `src/store/terminalDock.ts`
- `src/components/TerminalDock/index.tsx`
- `src/components/TerminalDock/WorkspaceBar.tsx`
- `src/components/TerminalDock/TerminalTabs.tsx`
- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/chat/queryChat/MessageItem/MessageActionMenu.tsx`
- `src/pages/chat/queryChat/MessageHistoryDrawer.tsx`
- `src/pages/e2e/E2EHarness.tsx`
- `e2e/electron/helpers/terminal.ts`
- `e2e/electron/specs/message-selection.spec.ts`
- `e2e/electron/specs/history-drawer.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`

Validation run:

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass. Result: 9 passed.

Important semantics and limits:

- `IMContextService` is pure bundle generation. It does not write workspace
  files, write terminal input, send IM messages, or manage runtime state.
- Terminal Dock is no longer the sole owner of IM-message-to-context generation,
  but it still owns workspace persistence and terminal handoff.
- No `@bot` behavior was added.
- No Auto Inject behavior was added.
- No Auto Reply or automated IM sending behavior was added.
- No attachment binary export was added.
- No multi-conversation context selector was added.
- `TERMINAL_CONTEXT_ACTION` remains only as a deprecated compatibility path;
  new UI actions use `IM_CONTEXT_ACTION`.

Recommended next implementation slice:

1. Add attachment binary save/export into workspace for local files and images.
2. Add a multi-conversation selector for context bundle creation.
3. Add an explicit context preview/reload path from persisted workspace files if
   needed.
4. Keep any future `@bot` / auto-send behavior behind a separate safety plan.

## Latest Update - P3 Fix + Electron E2E Baseline

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\新建 文本文档.txt`

Scope completed in this pass:

- Aligned the selected-message surface with the P1-P3 IM-native design.
- Extracted `MessageSelectionToolbar` from `ChatContent`.
- The selected toolbar now shows `Selected N messages`, `Copy`, `Export MD`,
  `More`, and `Clear`.
- Agent actions are no longer first-level toolbar actions; they are nested under
  `More -> Agent`.
- Kept disabled IM-native placeholders for `Forward` and `Delete` in the
  selected toolbar `More` menu.
- Kept per-message `MessageActionMenu` actions for `Copy`, `Quote`, `Select`,
  `Add to Selection`, and `Agent`.
- Kept chat-header `More` entries for `History`, `Select Messages`, disabled
  `Search Messages`, and disabled `Export Chat`.
- Removed the selected-toolbar implementation from `ChatContent`, so the chat
  surface is no longer mixing selection action logic into the message list.
- Added stable `data-testid` anchors for chat header, message actions,
  selection checkboxes, selected toolbar, history drawer, Terminal Dock, and the
  E2E harness.
- Added a Playwright Electron test baseline under `e2e/electron`.
- Added `playwright.electron.config.ts`.
- Added an Electron `#/e2e-harness` route with local mock conversation/messages
  so tests do not depend on real OpenIM accounts, network, server state, history,
  or agent runtime processes.
- Added `E2E_MODE=1` main-process behavior for Electron tests:
  - use isolated `userData` under temp;
  - skip single-instance lock;
  - skip tray creation;
  - skip native OpenIM SDK initialization.
- Stabilized Electron E2E window behavior:
  - show the main window directly in `E2E_MODE`;
  - let the E2E window close terminate instead of hiding to tray;
  - navigate tests directly to the built `dist/index.html#/e2e-harness`;
  - make Terminal Dock opt-in for the harness via `?terminal=1`, so message
    selection tests are not covered by the dock overlay.

Changed files in this pass:

- `electron/main/index.ts`
- `electron/main/windowManage.ts`
- `package.json`
- `playwright.electron.config.ts`
- `e2e/electron/fixtures/electronApp.ts`
- `e2e/electron/fixtures/mockOpenIM.ts`
- `e2e/electron/helpers/selectors.ts`
- `e2e/electron/helpers/wait.ts`
- `e2e/electron/specs/history-drawer.spec.ts`
- `e2e/electron/specs/message-selection.spec.ts`
- `e2e/electron/specs/terminal-dock.spec.ts`
- `src/components/TerminalDock/index.tsx`
- `src/layout/TopSearchBar/index.tsx`
- `src/pages/chat/queryChat/ChatContent.tsx`
- `src/pages/chat/queryChat/ChatHeader/index.tsx`
- `src/pages/chat/queryChat/MessageHistoryDrawer.tsx`
- `src/pages/chat/queryChat/MessageItem/MessageActionMenu.tsx`
- `src/pages/chat/queryChat/MessageItem/index.tsx`
- `src/pages/chat/queryChat/MessageSelectionToolbar.tsx`
- `src/pages/e2e/E2EHarness.tsx`
- `src/routes/index.tsx`
- `src/utils/e2eMockData.ts`

Validation run:

- `git diff --check`: pass.
- `npm.cmd run lint -- --quiet`: pass. Existing warning: React version is not
  specified in eslint-plugin-react settings.
- `npx.cmd tsc --noEmit`: pass.
- `npm.cmd run build`: pass. Existing Vite/AntD/chunk-size warnings remain.
- `npm.cmd run test:e2e`: pass in approved GUI/Electron execution. Result:
  5 passed.

Important semantics and limits:

- This is P3-fix plus an E2E baseline, not P6.
- No neutral `IMContextService` was introduced in this pass.
- No attachment binary export was added.
- No multi-conversation context selector was added.
- No `@bot`, auto inject, or auto reply behavior was added.
- Terminal Dock still remains a side terminal/workspace surface; this pass only
  added test anchors and kept Draft -> Chat off by default.
- The E2E harness is a hidden route included in the app bundle for now. It exists
  to make tests independent from real accounts and OpenIM network state.

Recommended next implementation slice:

1. If the hidden `#/e2e-harness` route is not acceptable in production bundles,
   add a stable Windows-safe build flag or separate harness entry that avoids the
   current esbuild config-loader crash.
2. Continue with P4/P5 hardening on top of the now-green Electron baseline.

## Latest Update - Message Search and Range Context MVP

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\# Plan IM-native Message Actions, H.txt`

Scope completed in this pass:

- Extended `MessageHistoryDrawer` with Phase 5 search/filter controls.
- Added current-conversation keyword search via `IMSDK.searchLocalMessages`.
- Added message type filter for `All types`, `Text`, and `Image`.
- Added date range picker and frontend range filtering.
- Search results reuse the same `useMessageSelectionStore` as regular chat and
  history selection.
- `Create Context` works from selected search results through the existing
  selected-message context flow.
- `Reset` returns the drawer to the currently loaded history result set.

Important semantics and limits:

- Keyword search is the OpenIM local-message search path.
- Date range and message type are currently frontend filters over returned
  search results or currently loaded history messages.
- Without a keyword, `Apply` filters the history messages already loaded in the
  drawer; it does not scan the full local database.
- `searchTimePosition` / `searchTimePeriod` are not wired yet because their SDK
  semantics need a separate compatibility check.
- Context creation still uses `TERMINAL_CONTEXT_ACTION` for compatibility.

Recommended next implementation slice:

1. Validate OpenIM SDK time-search semantics and wire range search server-side
   or local-DB-side if reliable.
2. Add search-result export.
3. Extract a neutral IM context action/service before expanding to
   multi-conversation context.

## Latest Update - IM History Drawer MVP

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\# Plan IM-native Message Actions, H.txt`

Scope completed in this pass:

- Added `MessageHistoryDrawer` as the Phase 4 IM-native history drawer MVP.
- Added `History` to the chat-header `More` menu.
- The drawer loads current-conversation history with
  `IMSDK.getAdvancedHistoryMessageList`.
- Supported quick history windows: recent `20`, `50`, and `100`.
- Supported `Load More` paging using the oldest loaded `clientMsgID`.
- History rows can be selected with the existing `useMessageSelectionStore`.
- `Select Visible`, `Copy`, `Create Context`, and `Clear` work from the same
  selected-message model used by the main chat window.
- `Search Messages` and `Export Chat` are visible disabled placeholders in the
  header menu to keep the intended IM menu shape clear.

Important semantics:

- This is an IM-side history drawer, not a Terminal Dock history feature.
- It does not implement keyword search, date range filtering, or multi-conversation
  context selection yet.
- `Create Context` still routes through the existing
  `TERMINAL_CONTEXT_ACTION` event and selected-message context builder.
- The event name remains terminal-flavored for compatibility; a later cleanup
  should introduce a neutral IM context event.

Recommended next implementation slice:

1. Add keyword search and basic range filtering inside the history drawer.
2. Extract a neutral IM context action event/service so history, selection, and
   terminal integration are less coupled.
3. Add chat export only after deciding whether it downloads locally or writes to
   the active workspace.

## Latest Update - Quote to Draft MVP

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\# Plan IM-native Message Actions, H.txt`

Scope completed in this pass:

- Enabled the per-message `Quote` action.
- `Quote` now appends a readable quote block to the current chat input draft via
  the existing `APPEND_CHAT_INPUT` event.
- Added `formatMessageAsQuoteText` to `src/utils/messageSelectionFormat.ts`.

Important semantics:

- This is a draft-level quote MVP.
- It does not create an OpenIM native quote/reference message yet.
- It does not change send-message payload structure or IM SDK calls.
- `Forward`, `Delete`, and `Recall` remain disabled placeholders.

Recommended next implementation slice:

1. Decide whether quote should remain plain text or use OpenIM native quote
   message support.
2. Add a visible quote preview chip above the editor if native quote state is
   adopted.
3. Implement Forward only after target conversation selection UX is defined.

## Latest Update - Header Selection Entry and Menu Shape

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\# Plan IM-native Message Actions, H.txt`

Scope completed in this pass:

- Added a chat-header `More` dropdown with `Select Messages`.
- `Select Messages` enters the existing IM-native selection mode for the current
  conversation.
- Added disabled placeholder entries to the per-message action menu:
  - `Quote`;
  - `Forward`;
  - `Delete`;
  - `Recall`.

Important semantics:

- Quote / Forward / Delete / Recall are intentionally disabled placeholders in
  this pass; no OpenIM SDK mutation behavior was wired yet.
- The selectable-message flow and Agent submenu from the prior pass remain
  unchanged.
- This keeps the menu shape aligned with mature IM expectations while avoiding
  pretending unsupported operations are implemented.

Recommended next implementation slice:

1. Wire `Quote` into the chat input draft model.
2. Add a real `Forward` flow only after choosing/confirming target conversation
   behavior.
3. Keep destructive actions (`Delete`, `Recall`) disabled until their SDK
   semantics and confirmation UX are explicit.

## Latest Update - IM-native Message Actions MVP

Current branch: `feature/terminal-dock-redesign`

Plan source:

- `C:\Users\leon\Desktop\# Plan IM-native Message Actions, H.txt`

Scope completed in this pass:

- Started Phase 1-3 from the IM-native message actions plan.
- Added `MessageActionMenu` for each chat message:
  - right-click menu;
  - hover `...` action entry;
  - `Copy`;
  - `Select`;
  - `Add to Selection`;
  - `Agent -> Create Agent Context`;
  - `Agent -> Copy Agent Prompt`;
  - `Agent -> Send Prompt to Terminal`.
- Extended the message selection store with:
  - `addMessageSelection`;
  - `selectOnlyMessage`.
- Reworked the selected-message toolbar to be IM-native first:
  - `Copy`;
  - `Export MD`;
  - `More`;
  - `Clear`.
- Moved Agent actions from primary toolbar buttons into `More -> Agent`.
- Removed the always-visible floating `Select Messages` main entry. Selection
  now starts from message-level actions.
- Added `messageSelectionFormat.ts` to format selected messages as plain text or
  markdown for IM-native copy/export.

Important semantics:

- Agent actions still reuse the existing selected-message context flow via
  `TERMINAL_CONTEXT_ACTION`.
- This pass does not introduce `@bot`, auto-inject, auto-reply, history drawer,
  or search.
- `Export MD` is a local browser/Electron download of selected messages; it does
  not write to the terminal workspace.
- Text copy is supported for text messages; unsupported message types get a
  placeholder in selected-message export.

Known limits after this pass:

- The event name is still `TERMINAL_CONTEXT_ACTION`; a later Terminal cleanup
  phase should introduce a more neutral `IM_CONTEXT_ACTION`.
- Header-level chat menu entry for selection mode is not implemented yet.
- Quote/forward/delete/recall entries are still future work.

Recommended next implementation slice:

1. Add a chat-header menu entry for `Select Messages`.
2. Add placeholder disabled menu entries for Quote / Forward / Delete / Recall
   so the menu shape matches mature IM expectations.
3. Add IM History Drawer MVP after message-level actions feel stable.

## Latest Update - Context History Path Actions

Current branch: `feature/terminal-dock-redesign`

Scope completed in this pass:

- Added path-level actions to each `Context History` record:
  - `Copy Prompt`;
  - `Copy MD`;
  - `Copy Manifest`;
  - `Copy Full Path`;
  - `Open`;
  - `Send`.
- `Copy MD` and `Copy Manifest` copy workspace-relative paths, which are useful
  inside terminal agents already running from the workspace root.
- `Copy Full Path` copies the absolute markdown file path for external tools or
  manual debugging.
- `Open` opens the active workspace folder through the existing
  `terminal:openWorkspace` IPC.
- History action buttons now wrap in narrow dock widths.

Important semantics:

- This pass did not add a file-read IPC or load markdown content back into the
  renderer.
- This pass did not auto-inject file contents into terminal stdin.
- Context files are still consumed by CLIs through file paths and explicit user
  actions.

Recommended next implementation slice:

1. Add attachment binary export into workspace when local paths or downloadable
   URLs are available.
2. Add `Copy manifest full path` if external non-workspace tools need it.
3. Add context file preview reload only if a safe read IPC is introduced.

## Latest Update - Workspace Context Bundle History

Current branch: `feature/terminal-dock-redesign`

Scope completed in this pass:

- Added workspace-level context bundle history metadata in
  `src/store/terminalDock.ts`.
- Persisted the last 20 context bundle records per workspace in localStorage.
- Each history record stores metadata only:
  - bundle id;
  - source kind;
  - conversation id;
  - message / attachment / character counts;
  - markdown and manifest paths;
  - short prompt text.
- `Create Context` now shows `Context History` for the active workspace.
- History rows can `Copy` the prompt or `Send` the prompt to the active terminal.
- `Clear History` removes only local metadata; already written workspace files are
  not deleted.

Important semantics:

- Context markdown and manifest files remain the source of truth on disk.
- History does not persist full markdown content in localStorage.
- Sending a history item still writes only the short prompt that references
  files; it does not paste raw chat history into terminal stdin.
- No runtime profile, API key, model config, or agent session management was
  added.

Known limits after this pass:

- History entries do not re-open the markdown file content yet; preview remains
  tied to the most recently generated bundle in memory.
- Date-range and multi-conversation context sources are still not implemented.
- Attachment binary export remains future work.

Recommended next implementation slice:

1. Add `Open context folder` / `Copy markdown path` actions to context history.
2. Add attachment file copy/download into workspace when local file paths or
   downloadable URLs are available.
3. Add date-range context after recent and selected-message flows feel stable.
4. Keep full `@bot` automation behind explicit trigger/pending-prompt safety
   gates.

## Latest Update - Direct Selected Context Toolbar Actions

Current branch: `feature/terminal-dock-redesign`

Scope completed in this pass:

- Replaced the chat selection toolbar's ambiguous `Use Context` action with
  direct actions:
  - `Create Context`;
  - `Copy Prompt`;
  - `Send to Terminal`.
- Added `TERMINAL_CONTEXT_ACTION` event payload in `src/utils/events.ts`.
- Terminal Dock now listens for selected-message context actions even while the
  panel is collapsed, then opens the dock/dialog and runs the requested action.
- Direct toolbar actions still route through Terminal Dock, so ChatContent does
  not write workspace files or inject terminal input directly.

Important semantics:

- `Create Context` creates and previews a selected-message context bundle.
- `Copy Prompt` creates the selected-message bundle and copies the short prompt.
- `Send to Terminal` creates the selected-message bundle and writes only the
  short prompt to the active terminal.
- If no active workspace or terminal exists, Terminal Dock shows the existing
  warnings instead of attempting hidden setup.

## Latest Update - Selected Message Context MVP

Current branch: `feature/terminal-dock-redesign`

Scope completed in this pass:

- Added a lightweight, non-persistent message selection store:
  `src/store/messageSelection.ts`.
- Added current-conversation message selection mode in `ChatContent`.
- Added per-message checkbox and selected-row state in `MessageItem`.
- Terminal Dock now reads selected messages for the current conversation.
- `Context` menu includes `Create from selected messages`.
- `Create Context` dialog includes selected-message preview generation.
- Selected-message context reuses `createContextBundle` with
  `source.kind = "selectedMessages"`.

Important semantics:

- Selection is local UI state only and clears per conversation.
- OpenIM still writes markdown and manifest files to the active terminal
  workspace, then sends only a short prompt that references those files.
- `Use Context` in the chat selection toolbar only opens the Terminal Dock; the
  explicit context creation still happens in the Terminal Dock.

Known limits after this pass:

- Date-range context is not implemented.
- Multi-conversation context picker is not implemented.
- Binary attachment export is not implemented.
- Full `@bot` trigger routing remains spec-only.

Git status for this pass:

- Local commit: `92468bf feat: add selected message context flow`
- Push attempts to `origin/feature/terminal-dock-redesign` failed with GitHub
  HTTPS connection resets/timeouts.
- Local branch is ahead of origin until a later push succeeds.
- Backup patch/bundle is stored under the workspace-level `backups` directory.

Recommended next implementation slice:

1. Make selected-message toolbar actions more direct:
   `Create Context`, `Copy Prompt`, `Send to Terminal`.
2. Add attachment file save/copy for local image/file messages when paths are
   available.
3. Add context bundle log/history per workspace.

## Latest Update - Context Builder Recent Messages MVP

Current branch: `feature/terminal-dock-redesign`

Scope completed in this pass:

- Added a reusable IM Context Builder utility:
  `src/utils/imContextBuilder.ts`.
- Added `ContextBundle`, `ContextSource`, markdown generation, manifest
  generation, short prompt generation, and message time ordering.
- Reworked Terminal Dock IM -> Terminal controls:
  - `Context` dropdown;
  - `Create from recent messages...`;
  - `Copy Prompt`;
  - `Send Prompt`.
- Added a `Create Context` dialog for current-conversation recent messages.
- The dialog lets the user choose a recent message count, create a preview,
  copy the generated prompt, or send the prompt to the active terminal.
- Context files are written into the active terminal workspace:
  - `context/bundle_*.md`;
  - `context/bundle_*.manifest.json`.
- Added `docs/terminal-bot-routing-spec-v0.md` as the safety/spec foundation
  for future `@bot` routing.

Important semantics:

- The prompt is intentionally short and references exported files.
- OpenIM does not paste the whole chat history into terminal stdin.
- `Send Prompt` means write the current generated prompt to the active terminal
  and press Enter.
- No full `@bot` trigger, auto-inject, or auto-reply behavior is implemented.

Known limits after this pass:

- Selected-message context is not implemented yet.
- Date-range and multi-conversation context are not implemented yet.
- Attachment files are referenced in the manifest when metadata is available;
  this pass does not download/copy binary attachments into workspace folders.
- Manual Electron verification should still be repeated for the full terminal
  flow.

Recommended next implementation slice:

1. Add message multi-select mode in the current conversation message list.
2. Store selected message IDs in a small UI store.
3. Add `Create from selected messages` to the `Context` menu.
4. Reuse `createContextBundle` with `source.kind = "selectedMessages"`.
5. Add context preview and prompt send behavior to the selected-message flow.

## Next Phase - IM Context Builder

Current branch: `feature/terminal-dock-redesign`

Next development focus:

- Build the IM-to-terminal direction around an explicit Context Builder.
- Keep Terminal Dock as a generic terminal host; do not add runtime-specific
  model/API key/session management.
- Do not implement full `@bot` automation yet.

Recommended MVP:

- Create context from recent messages in the current conversation.
- Create context from manually selected messages in the current conversation.
- Write a context markdown file and manifest JSON into the active workspace.
- Generate a short prompt that references the exported files instead of pasting
  large chat history directly into the terminal.
- Add preview/copy/send actions for the generated prompt.

Suggested UI reorganization:

- Runtime controls: profile selector, run profile, new terminal, restart, stop,
  open workspace, pop out.
- IM -> Terminal: context menu, copy prompt, send prompt to active terminal.
- Terminal -> IM: selection to draft, capture output, output to draft,
  draft to chat experimental, clear.

Bot readiness scope:

- Write `Terminal Bot Routing Spec v0` before implementation.
- Future `@bot` should create a pending prompt and require explicit user action
  before terminal injection.
- Remote IM messages must not auto-run local terminal commands by default.
- `Draft -> Chat (experimental)` remains off by default.

Acceptance target for the next phase:

- User can create a context bundle from latest N messages.
- User can multi-select messages and create a context bundle from selected
  messages.
- User can preview generated markdown.
- User can copy the prompt or send it to the active terminal.
- Existing Terminal -> IM output capture still works.

## Latest Update - Terminal Output Handoff Safety + xterm Theme Fix

Current branch: `feature/terminal-dock-redesign`

Scope for this phase:

- This phase implements terminal-output-to-chat-draft handoff only.
- Terminal Dock remains a generic terminal host plus terminal-output handoff demo.
- Runtime behavior stays owned by each CLI product such as `opencode`, `codex`,
  `claude`, and `gemini`.

Implemented in this phase:

- terminal tabs;
- run profiles / command templates;
- copy context prompt;
- paste prompt into terminal;
- selection to IM;
- capture terminal output;
- optional output-to-draft;
- optional draft-to-chat send.

Not implemented in this phase:

- IM message trigger;
- `@bot` trigger;
- group mention routing;
- automatic IM-to-terminal injection;
- bot ownership model;
- agent runtime adapter;
- parsing final answer from agent runtime;
- reliable final-answer extraction from `opencode` / `codex` / `claude` TUI
  output.

Current handoff semantics:

- `Capture Output` means screen/output capture, not agent reply capture.
- `Output -> Draft` fills the chat draft from captured terminal output after the
  terminal output settles.
- `Draft -> Chat (experimental)` remains off by default and only auto-sends
  after stricter debounce / dedupe / minimum-length / minimum-interval checks.
- `Selection -> IM` remains the safest recommended path because the user still
  explicitly selects and reviews text before sending.
- `Selection -> IM` now has a TUI fallback path: if `xterm` does not expose a
  live selection, OpenIM opens a selectable plain-text snapshot of the current
  visible screen, or recent output when the visible screen is too small.
- This fallback is intended for full-screen TUIs such as `opencode`, where
  mouse handling or alternate-screen rendering may prevent normal xterm
  selection APIs from returning text.

Terminal theme/readability update:

- Replaced ANSI blue readability fixes based on output rewriting with an xterm
  theme-level readable ANSI palette.
- Explicitly set xterm theme colors for `foreground`, `background`, `blue`,
  `brightBlue`, and the rest of the ANSI palette.
- Set `minimumContrastRatio` to `4.5`.
- Re-apply the xterm theme when the document theme or system color scheme
  changes.
- Added a dev-only debug log that prints the active xterm theme snapshot for
  `blue`, `brightBlue`, `foreground`, `background`, and
  `minimumContrastRatio`.

Auto-send safety guardrails:

- Empty or whitespace-only output is not sent.
- Output shorter than 8 characters is not sent.
- Prompt-only / shell-banner / current-working-directory-only capture is not
  sent.
- Repeated captured content is deduplicated by hash before draft/send.
- Auto-send requires at least 5 seconds of quiet output before sending.
- Sending still goes through `ChatFooter` events instead of direct OpenIM SDK
  calls from `TerminalDock`.

Backup artifacts created before this pass:

- `0001-feat-add-terminal-output-capture-demo.patch`
- `terminal-dock-redesign-e16a89b.bundle`
- `terminal-dock-selection-fallback-<timestamp>.patch`

Validation to repeat after reload / Electron restart:

```bash
git diff --check
npm.cmd run lint -- --quiet
npx.cmd tsc --noEmit
npm.cmd run build
```

Manual checks to repeat in Electron:

1. Open the right-side Terminal Dock.
2. Start a PowerShell tab and confirm the path prompt is readable.
3. Verify `Capture Output`, `Output -> Draft`, and `Draft -> Chat (experimental)`
   semantics.
4. Keep `Draft -> Chat (experimental)` off by default.
5. Turn it on and confirm dedupe / 5-second quiet period prevent repeated
   sends.
6. Confirm Terminal Dock still does not directly call OpenIM SDK for sending.

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

## Latest Update - P11.5B IM File/Image UX Foundation

Implemented:

- `final_answer.md` remains the source of truth for IM auto-reply text.
- Terminal Dock now shows `Final Answer Preview` from the same resolver used by Auto Reply Text.
- The OpenIM final answer skill now tells agents that `final_answer.md` must contain the complete IM-ready user reply, must not contain debug notes, and that terminal/TUI completion text should stay short.
- Auto output-file attach now stats workspace files before enqueueing them, preserves real file size, and only emits file-only send when at least one attachment was actually queued.
- Repeated `auto-sent` toast spam was guarded by counting successfully queued files.
- Manual Electron file picker and Agent Output Files now share image/file inference:
  - image extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`
  - MIME values starting with `image/`
- Image attachments route through `createImageMessageFromFullPath`.
- Normal file attachments route through `createFileMessageFromFullPath`.
- Attachment sends now treat SDK send failure as a real failure so the draft attachment can return to pending instead of silently disappearing.
- Successful local sends cache `clientMsgID -> nativePath` for later desktop open/show-in-folder behavior.
- File cards no longer default to browser navigation:
  - cached local file: open via Electron `shell.openPath`
  - cached local file: show in folder via Electron `shell.showItemInFolder`
  - remote file: download to local Downloads, cache the native path, then open
- File message action menu uses the same Electron download/open path for FileMessage `View`/`Download`, plus `Save as`, `Show in folder`, and `Copy file name`.
- Local Docker OpenIM `.env` MinIO external address was changed to `http://127.0.0.1:10005` for same-host Electron clients.
- Added targeted Electron E2E coverage in `e2e/electron/specs/file-image-ux.spec.ts`:
  - `Final Answer Preview` resolves from `final_answer.md`.
  - `## Output Files` auto-file attach sends image outputs as `sendKind: image` and normal outputs as `sendKind: file`.
  - File card/menu actions use Electron IPC for open/download/save-as/show-in-folder rather than default browser navigation.
  - Picture messages keep the built-in image preview renderer.
- E2E harness now mocks `workspace:statFile`, stable file mtimes, sent attachment snapshots, and desktop file IPC actions.
- Important verification note: Playwright Electron E2E loads `dist/index.html`, so run `npm.cmd run build` before `npx.cmd playwright test -c playwright.electron.config.ts ...` when testing source changes.

Latest verification:

- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run lint -- --quiet` passed.
- `npm.cmd run build` passed; only existing Vite/AntD chunk/directive warnings.
- `$env:TS_NODE_COMPILER_OPTIONS='{ "module": "commonjs" }'; npx.cmd ts-node src/utils/attachmentKind.test.ts` passed.
- `$env:TS_NODE_COMPILER_OPTIONS='{ "module": "commonjs", "esModuleInterop": true }'; npx.cmd ts-node src/services/agentRunContract/AgentRunContractService.test.ts` passed.
- `npx.cmd playwright test -c playwright.electron.config.ts e2e/electron/specs/file-image-ux.spec.ts` passed: 3/3.

Not implemented:

- Folder sending.
- Folder card.
- Add-to feature.
- Cloud drive.
- Native OpenCode same-session extraction.

## 2026-06-30 Windows Production Packaging Handoff

### Packaging tool

- Uses the existing `electron-builder` setup.
- App identity is now `appId: com.openim.agent`, `productName: OpenIM Agent`.

### Scripts

- `npm run build`
- `npm run build:renderer`
- `npm run build:main`
- `npm run package:win`
- `npm run package:win:portable`
- `npm run dist:win`

### Outputs

- Installer: `release/OpenIM-Agent/1.0.0/OpenIM-Agent-Setup-1.0.0.exe`
- Portable: `release/OpenIM-Agent/1.0.0/OpenIM-Agent-Portable-1.0.0.exe`
- Copied into the root offline package:
  - `../离线部署/windows-client/OpenIM-Agent-Setup-1.0.0.exe`
  - `../离线部署/windows-client/OpenIM-Agent-Portable-1.0.0.exe`

### Production config

- Default template: `extraResources/default-config.json`
- Runtime user config: `%APPDATA%/OpenIM Agent/config.json`
- First launch copies/merges defaults into `config.json`.
- OpenIM defaults:
  - API: `http://10.96.253.9:10002`
  - WS: `ws://10.96.253.9:10001`
  - Chat API: `http://10.96.253.9:10008`
- LLM API default: `http://10.96.248.17:8000/v1`
- OpenCode command default: `opencode`

### How to change addresses

Close the app, edit `%APPDATA%/OpenIM Agent/config.json`, then reopen.

- Change OpenIM server under `openim.apiUrl`, `openim.wsUrl`, and `openim.chatUrl`.
- Change OpenCode path under `opencode.command`, for example:
  `C:\\Users\\leon\\AppData\\Local\\OpenIM-Agent\\opencode\\bin\\opencode.exe`
- Change workspace root under `terminal.defaultWorkspacePath`.

### Verification

- `npm.cmd test` passed.
- `npm.cmd run build` passed.
- `npm.cmd run package:win` produced the installer.
- `npm.cmd run package:win:portable` produced the portable exe.

## 2026-07-16 Agent-session automatic IM delivery

- Restored per-Agent-session switches for `Auto send reply` and `Auto attach outputs`; both default to off and enabling either requires an explicit warning dialog.
- Delivery is now contact-safe: Main emits a request containing the bound `conversationID`, so a background Agent cannot accidentally send through the currently visible chat composer.
- Text delivery supports online and offline conversations. Output file/folder delivery supports online OpenIM and reports an explicit unsupported error in offline mode.
- Completed assistant messages are deduplicated by runtime message ID and the delivery checkpoint is persisted with the Agent session.
- `## Output Files` and `## Output Folders` are parsed from the final assistant response. Paths are restricted to the session workspace, missing paths are ignored, folders take priority over child files, and images retain image-message routing.
- OpenCode receives a system hint describing the output section contract whenever automatic output attachment is enabled.
- Added `tests/agentDelivery.test.ts`; `npm.cmd test` and `npm.cmd run build:renderer` pass.
- The Agent Electron E2E reached and passed the new switch visibility assertions and all existing UI assertions, but the Playwright worker exited nonzero during Electron teardown without reporting a failed test ID (`failedTests: []`).
