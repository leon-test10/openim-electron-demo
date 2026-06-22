# opencode Runtime Offline Smoke

This phase keeps runtime binaries outside git and commits only the adapter contract,
profile defaults, and bundle manifest.

## Local Model Contract

- Base URL: `http://127.0.0.1:8080/v1`
- Model: `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`
- API key: `local`
- Smoke prompt: `Reply with READY only.`

## Runtime Dock Flow

1. Open a chat conversation.
2. Open `Runtime Dock`.
3. Add `opencode-local`.
4. Start the runtime.
5. Send the smoke prompt.
6. Confirm the transcript shows a local model response.

## Offline Bundle Contract

The opencode archive should be published as a GitHub Release asset or copied by
other offline media. The git repo stores
`runtime-bundles/opencode-win-x64-local.manifest.json`; once the archive is
built, replace `TBD_AFTER_BUNDLE_BUILD` with the archive SHA-256.

The current implementation proves the IM-to-runtime bridge against the local
OpenAI-compatible model endpoint. The next hardening step is to replace the
smoke adapter internals with the bundled `opencode run` process while keeping
the same Runtime Dock IPC contract.
