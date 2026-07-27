# Human-Agent Collaboration Loop V1

## Product Boundary

V1 treats a person and an Agent as first-class participants in the same OpenIM
conversation while keeping publication authority with the person:

```text
IM request
-> requester-owned context authorization
-> bound Agent Session and Runtime Run
-> streaming execution and human interaction
-> staged text and Artifacts
-> human review/edit
-> confirmed IM publication
```

Runtime completion never publishes directly to IM. Auto-reply controls remain
disabled for this path and cannot bypass staging.

## Request and Context Contract

`AgentRequest` is the durable boundary between an IM message and a Runtime Run.
It carries `requestID`, conversation/requester/target identities, instruction,
optional Runtime, creation time, and an immutable `ContextPolicy`.

The requester's policy owns:

- the normalized recent-message limit;
- explicitly selected message IDs, which take priority over recent history;
- whether attachment metadata may enter the context bundle;
- the conversations the request authorizes.

The executing Agent client validates this envelope and cannot replace it with
its own local context setting. The actual selected message count is recorded on
the turn and trace-facing result metadata. A malformed or mismatched explicit
envelope is rejected instead of silently expanding context. Legacy triggers use
a bounded compatibility policy.

## Binding and Recovery

The UI derives one of these states:

```text
unbound
bound
runtime_starting
runtime_running
runtime_disconnected
im_offline
recovering
failed
```

Conversation binding, Runtime health, and OpenIM connection health are separate
signals. Persisted Agent Sessions are recovered after reload. A Runtime failure
offers Reconnect; an OpenIM outage leaves the Agent binding visible and reports
`im_offline`.

Permission and question interactions contain the originating `runID`. Replies
with a mismatched Run are rejected, preventing a contact or session switch from
answering the wrong execution.

## Result and Artifact State

Runtime output follows:

```text
running -> completed_staged -> approved -> published
```

The staged record contains editable final text plus `AgentArtifact` records for
files, images, folders, and text outputs. A non-empty folder is represented by
one folder Artifact; descendants are delivered through the folder-share
manifest and are not sent again as individual files. Folder download restores
the manifest's nested tree, including the empty-folder case.

Only `Confirm and Send` starts publication. Removing an Artifact changes the
staged result before approval. A rejection remains explicit; Retry creates a
new request/run lineage. Partial failures keep the result in staging, mark only
failed pending Artifacts, and preserve already published text/Artifacts so a
retry does not intentionally duplicate them.

## Trace and Controlled Improvement

Every request has a compact trace containing identities, timestamps, Runtime,
status, counts for retry/permission/question/Artifacts, takeover, publication,
and an optional failure code. Raw terminal output, API keys, environment
variables, and message bodies are not copied into the trace.

An `ImprovementCandidate` may be created from:

- Runtime error;
- repeated retry;
- human takeover;
- publication failure;
- explicit user feedback.

Candidate text is length-bounded and secret-like values are redacted. Normal
successful Runs do not create candidates. The backlog only supports human
triage: approve, reject, or convert to a development Goal. It performs no
automatic source, prompt, permission, Git, merge, or deployment changes.

## Verification

The release gate is:

```text
npm run typecheck
npm run lint -- --quiet
npm test
npm run build
npx playwright test -c playwright.electron.config.ts
```

The focused desktop scenarios are named:

- `requester-context-policy`;
- `session-binding-recovery`;
- `result-staging`;
- `artifact-folder-delivery`;
- `improvement-candidate`.

The production build additionally checks every Electron relative import and
rejects main-process dependencies on renderer source paths.
