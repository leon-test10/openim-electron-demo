# Runtime Dock Terminal Host

Runtime Dock is now terminal-first. OpenIM hosts a terminal session; each
runtime CLI owns its own provider/model/API-key configuration.

## Boundary

- OpenIM manages terminal attachment lifecycle, display, input, output, stop,
  and restart.
- Runtime tools such as opencode, Codex, Claude Code, or custom CLIs manage
  their own config.
- `http://127.0.0.1:8080/v1` is available to runtime CLIs through their own
  config or terminal environment. OpenIM no longer calls this endpoint directly.

## Runtime Dock Flow

1. Open a chat conversation.
2. Open `Runtime Dock`.
3. Add a terminal attachment.
4. Start the terminal in the Electron app.
5. Run shell commands or a runtime CLI such as `opencode`.
6. Confirm stdout/stderr appears in the Dock transcript.

## Offline Bundle Contract

The opencode archive should be published as a GitHub Release asset or copied by
other offline media. The git repo stores
`runtime-bundles/opencode-win-x64-local.manifest.json`; once the archive is
built, replace `TBD_AFTER_BUNDLE_BUILD` with the archive SHA-256.

The current implementation starts PowerShell through Electron main using
`child_process.spawn`. The next hardening step is to move to `node-pty` and
`xterm.js` for full terminal semantics.
