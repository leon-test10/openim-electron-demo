# Terminal Dock opencode Local Smoke

This project does not manage opencode API keys, models, prompts, memory, tools,
permissions, or sessions. OpenIM only provides a terminal workspace and exported
IM context files.

For `opencode-ai@1.17.9`, put this `opencode.json` in the terminal workspace
root when using the local OpenAI-compatible endpoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "local-openai/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
  "provider": {
    "local-openai": {
      "name": "Local OpenAI Compatible",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "local"
      },
      "models": {
        "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf": {
          "name": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
          "id": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
          "provider": {
            "npm": "@ai-sdk/openai-compatible"
          }
        }
      }
    }
  }
}
```

Smoke command:

```powershell
npx.cmd -y opencode-ai@1.17.9 run --model local-openai/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf "Reply with READY only."
```

To use exported OpenIM context files, first click `Copy Context Prompt` in the
Terminal Dock. That writes markdown files under the workspace `context/`
directory and copies a short prompt that references those files.

Then either paste the prompt inside an already-running opencode TUI, or pass it
to `opencode run`, for example:

```powershell
npx.cmd -y opencode-ai@1.17.9 run --model local-openai/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf "Use the OpenIM context exported in this workspace. Read ./context/<conversationID>/history-<timestamp>.md and answer based on it."
```

Do not paste raw multi-line markdown into PowerShell, Python REPL, or another
ordinary shell. It will be interpreted as commands. OpenIM exports context as
files; the CLI runtime should read those files.

Verified locally on 2026-06-22:

- `GET http://127.0.0.1:8080/v1/models` returned model
  `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`.
- `opencode run` returned `READY`.

Note: the published `opencode-ai@1.17.9` package uses the legacy `provider`
configuration field. The newer source tree also contains a `providers` field in
the v2 config schema, but that field was rejected by the published package in
this smoke test.
