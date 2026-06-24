# Session Handoff - Terminal Dock Redesign

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
  - `Preview Context`;
  - `Copy Prompt`;
  - `Send to Terminal`;
  - `Ignore`.
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
