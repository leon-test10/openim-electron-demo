# Terminal Bot Routing Spec v0

## Scope

This document defines the future `@bot` routing model for OpenIM Terminal Dock.
It is a specification only. The current implementation must not auto-inject IM
messages into a local terminal and must not auto-reply to chats.

## Ownership Model

- The bot belongs to the local logged-in OpenIM user.
- The terminal process runs on the local computer.
- CLI runtimes such as opencode, Codex, Claude, Gemini, or OpenHands own their
  own session, memory, tools, sandbox, permissions, model config, and API keys.
- OpenIM only creates context files, generates prompts, injects prompts after
  explicit user action, and optionally moves terminal output into the chat draft.

## Trigger Syntax

Single conversation:

```text
@bot summarize this
/bot summarize this
```

Group conversation:

```text
@localUser @bot summarize this
```

Group triggers must mention the local user first so a remote participant cannot
silently trigger every local user's terminal.

## Default Policy

- Trigger detection is off until explicitly enabled.
- Auto injection to terminal is off by default.
- Output to draft is off by default.
- Draft to chat is off by default and remains experimental.
- Remote users cannot trigger the local terminal unless the local user enables
  a policy that allows it.

## Pending Prompt Flow

Future trigger handling should create a pending prompt card instead of running
the terminal directly:

```text
IM trigger
  -> create ContextBundle
  -> generate Prompt
  -> show Pending Bot Request
  -> user clicks Inject to Terminal
  -> terminal output can be captured to draft
  -> user reviews draft
  -> user sends manually or enables Draft -> Chat
```

The pending card should show:

- sender;
- conversation;
- trigger message;
- context source policy;
- generated prompt preview;
- target terminal/workspace;
- actions: Inject to Terminal, Copy Prompt, Ignore.

## Safety Rules

- Never auto-inject arbitrary remote text into the local terminal by default.
- Never treat normal chat messages as terminal commands.
- Always create file-based context bundles instead of pasting large chat history
  directly into shell stdin.
- Do not send terminal output back to chat without a visible draft review path,
  unless the user explicitly enables Draft -> Chat.
- Log context bundle creation and terminal injection events locally.

## Stage Roadmap

Stage 0: Spec only.

Stage 1: Detect `@bot` and `/bot`, show a pending request, do not inject.

Stage 2: Generate ContextBundle and prompt for the pending request.

Stage 3: Manual Inject to Terminal.

Stage 4: Optional Auto Inject setting.

Stage 5: Full Auto Reply only when Trigger, Auto Inject, Output -> Draft, and
Draft -> Chat are all explicitly enabled.
