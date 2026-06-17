# Session Handoff - Runtime Dock Panel Phase 1

## Project

`openim-electron-demo`

## Branch

- Current branch: `feature/runtime-dock-panel`
- Base branch: `UI-feature`
- Scope: first-phase Runtime Dock scaffold only

## Goal

Add a collapsible, resizable Runtime Dock beside the OpenIM chat view. This phase only provides UI and local attachment state so later phases can add xterm.js, PTY, and real CLI runtimes.

## Completed

### Runtime Dock store

- Added `src/store/runtimeDock.ts`.
- Added `RuntimeAttachment`, `RuntimeAttachmentStatus`, and `RuntimeDockStore` types in `src/store/type.d.ts`.
- Exported the store from `src/store/index.ts`.
- Store behavior:
  - `panelOpen` defaults to `false`.
  - State persists to `localStorage` under `openim_runtime_dock_state`.
  - Attachments are grouped by `conversationID`.
  - `addPlaceholderRuntime(conversationID)` appends a local `Shell Placeholder`.
  - `removeAttachment(conversationID, attachmentID)` removes only from that conversation.

### Runtime Dock UI

- Added `src/components/RuntimeDock/index.tsx`.
- Displays:
  - `Runtime Dock` title.
  - Current conversation ID from store, with route param fallback.
  - Attachment count.
  - Empty state when no conversation is selected.
  - `No runtime attached` state for an empty conversation.
  - `Add Runtime` button.
  - Placeholder runtime cards with profile, status, timestamp, and remove action.
  - `Terminal will be added in Phase 2` notice.

### Chat layout

- Updated `src/pages/chat/index.tsx`.
- When dock is closed, original layout is unchanged: `ConversationSider + Outlet`.
- When dock is open, layout uses `PanelGroup direction="horizontal"`:
  - Left panel: existing chat UI.
  - Resize handle.
  - Right panel: `RuntimeDock`.

### Top bar entry

- Updated `src/layout/TopSearchBar/index.tsx`.
- Added `ApiOutlined` button with `Runtime Dock` tooltip.
- Button only appears on `/chat` routes.
- Clicking the button toggles the dock.

### i18n

- Added `runtimeDock` text group to:
  - `src/i18n/resources/zh.json`
  - `src/i18n/resources/en.json`

### TDD / contract check

- Added `src/store/runtimeDock.test.ts` as a TypeScript contract test for the store API.
- RED result: `npx.cmd tsc --noEmit` initially failed with missing `./runtimeDock`.
- GREEN result: missing module error is gone after implementation.

## Explicit Non-Goals

- No PTY.
- No xterm.js.
- No WebSocket terminal transport.
- No real Codex/opencode/OpenHands runtime launch.
- No API key/model/provider configuration.
- No server-side attachment persistence.

## Verification

Commands run from `openim-electron-demo`:

```bash
npx.cmd eslint src/components/RuntimeDock/index.tsx src/store/runtimeDock.ts src/store/runtimeDock.test.ts src/pages/chat/index.tsx src/layout/TopSearchBar/index.tsx
```

Result: exit 0. There are 9 warnings in existing `TopSearchBar` code, but 0 errors.

```bash
npx.cmd tsc --noEmit
```

Result: exit 1 due to pre-existing project type errors outside the Runtime Dock implementation. The original missing `src/store/runtimeDock` error from the RED step is resolved.

Known pre-existing TypeScript failures include:

- `src/components/DraggableModalWrap/index.tsx`
- `src/hooks/useGroupMembers.ts`
- `src/pages/chat/queryChat/ChatFooter/index.tsx`
- `src/pages/chat/queryChat/useHistoryMessageList.tsx`
- `src/pages/common/ChooseModal/ChooseBox/index.tsx`
- `src/pages/common/RtcCallModal/*`
- `src/pages/common/UserCardModal/index.tsx`
- `src/utils/messageExporter.ts`

Full `npm.cmd run lint` is also blocked by existing repository-wide Prettier CRLF errors. Targeted lint for touched Runtime Dock files and chat entry points passes with warnings only.

Browser smoke test, frontend only:

- Started dev server with `npm.cmd run dev -- --host 127.0.0.1`.
- Opened `http://127.0.0.1:5173` in the in-app Browser.
- Verified Runtime Dock icon appears on chat route.
- Verified dock opens and shows disabled Add Runtime when no conversation is selected.
- Selected `Codex Bot` conversation.
- Verified Add Runtime is enabled.
- Added `Shell Placeholder`.
- Verified `Terminal will be added in Phase 2` appears.
- Closed and reopened dock.
- Verified placeholder remained in the selected conversation.
- Removed browser test placeholders after verification.

Important verification boundary:

- `openim-docker` was not started for this phase.
- Docker daemon was not running during verification.
- This is not an end-to-end OpenIM backend verification.
- The browser test used the currently available frontend/local app state only.

## Manual Acceptance Checklist

- Enter `/chat`: top bar shows Runtime Dock icon.
- Click icon: right dock opens.
- Click close in dock: right dock collapses.
- Drag separator: dock width changes.
- Select a conversation and click `Add Runtime`: one `Shell Placeholder` appears.
- Switch conversation: previous placeholder is not shown.
- Switch back: placeholder reappears from `localStorage` state.
- Navigate outside `/chat`: top bar dock icon is hidden.

## Next Phase

Phase 2 should be `Runtime Dock Terminal Surface`.

Recommended branch:

`feature/runtime-dock-terminal`

Base branch:

`feature/runtime-dock-panel`

### Phase 2 Goal

Add a terminal-looking surface inside each Runtime Dock attachment, but keep it frontend-only. The purpose is to prove the dock can host per-attachment terminal UI, input state, output state, resize behavior, and tab/card-level isolation before adding PTY or real CLI processes.

### Phase 2 Scope

- Add a `RuntimeTerminal` component rendered inside each `Shell Placeholder` card.
- Prefer `xterm.js` if dependency/install friction is low; otherwise start with a styled mock terminal component and leave xterm.js for Phase 2.5.
- Show deterministic mock output, for example:
  - `Runtime surface ready`
  - `Profile: shell-placeholder`
  - `Attachment: <attachmentID>`
  - `PTY bridge not connected`
- Provide a local terminal input row.
- Pressing Enter should append the typed line to that attachment's local transcript.
- Add a clear/reset action for the local transcript.
- Keep transcript state keyed by `RuntimeAttachment.id`, not by conversation only.
- Preserve existing Runtime Dock behavior:
  - Dock toggle still works.
  - Add/remove placeholder still works.
  - Conversation isolation still works.
  - No backend or relay dependency is introduced.

### Suggested State Additions

Extend `RuntimeDockStore` with frontend-only terminal state:

```ts
interface RuntimeTerminalLine {
  id: string;
  kind: "system" | "input" | "output";
  text: string;
  createdAt: number;
}

terminalLinesByAttachment: Record<string, RuntimeTerminalLine[]>;
appendTerminalInput: (attachmentID: string, text: string) => void;
clearTerminalLines: (attachmentID: string) => void;
```

Do not store terminal state under `conversationID` alone. Multiple runtime attachments can exist inside the same IM conversation.

### Suggested Files

- Create `src/components/RuntimeDock/RuntimeTerminal.tsx`.
- Modify `src/components/RuntimeDock/index.tsx` to render `RuntimeTerminal` inside each attachment card.
- Modify `src/store/runtimeDock.ts` and `src/store/type.d.ts` for transcript state/actions.
- Update `src/store/runtimeDock.test.ts` so TypeScript contract covers per-attachment terminal lines.
- Extend `runtimeDock` i18n keys in `zh.json` and `en.json`.

### Phase 2 Non-Goals

- Do not start PowerShell, bash, Codex, opencode, OpenHands, or any real child process.
- Do not add node-pty yet.
- Do not add WebSocket transport yet.
- Do not send terminal input to `agent-relay`.
- Do not add API key/model/provider configuration.
- Do not require `openim-docker` for this phase.

### Phase 2 Acceptance

- Open chat route and expand Runtime Dock.
- Select a conversation.
- Add one `Shell Placeholder`.
- Terminal surface appears inside that attachment.
- Typing text and pressing Enter appends an input line only in that attachment.
- Adding a second placeholder creates a separate terminal transcript.
- Removing one placeholder does not affect the other placeholder.
- Switching conversations preserves per-conversation attachments and their own terminal UI state.
- Targeted eslint for touched files has 0 errors.
- Any failed full-project `tsc`/lint must be documented as pre-existing unless Phase 2 introduces new errors.

### Phase 3 Preview

Only after Phase 2 terminal UI is stable, Phase 3 should add the PTY bridge:

1. Add local bridge API/WebSocket shape.
2. Start a mock shell or PowerShell process.
3. Stream stdout/stderr into `RuntimeTerminal`.
4. Send terminal input to PTY stdin.
5. Add stop/interrupt controls.
