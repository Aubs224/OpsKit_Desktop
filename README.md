# OpsKit Desktop V1.1

<img width="1919" height="1027" alt="image" src="https://github.com/user-attachments/assets/e3996251-393e-415b-a891-0c5901d47b5d" />

A Windows-first Electron + Node desktop chat client for OpsKit-managed AI sessions. V1 supports Cohere Command A and Anthropic Claude behind a provider adapter interface, with local file extraction, flat-file OpsKit memory, keychain-backed API key storage, and a local chat-history sidebar.

## What is included

- Electron main/renderer/preload shell with `contextIsolation` enabled and `nodeIntegration` disabled.
- Cohere adapter using `/v2/chat` with native `documents` grounding. `assets/OpsKit_Quick_Setup.txt` is always sent as `documents[0]`.
- Claude adapter using Anthropic Messages API with Layer 1 and Layer 2 prepended to the `system` field.
- Session naming prompt with kebab-case slug normalization.
- Chat-history sidebar with local session list, one-click reopen, and **New** session flow.
- Persisted full chat transcripts stored as local JSON files under Electron `userData/sessions`.
- `/opskit_memory/` flat-file selection by session slug, newest-first, capped by `MEMORY_FILE_LIMIT`.
- Receipt detection on `[::📋::]` and append to the active session's `YYYY-MM-DD_[chat-name].txt` memory receipt file.
- PDF, DOCX, and TXT extraction for user uploads.
- Settings panel for provider, models, memory file limit, memory directory, Quick Setup path, and API key entry.
- API keys stored via OS keychain using `@github/keytar` or `keytar`. Electron `safeStorage` fallback is opt-in only.
- Cohere RISK-01 boot validation button and CLI script.
- Node unit tests for memory selection, receipt extraction/appending, context document assembly, and session-history persistence.

## Requirements

- Windows 10/11 for the target V1 deployment.
- Node.js 22 or newer. Electron 42 bundles Node 24 at runtime, but the dev install should use Node 22+.
- Build tools may be needed for native keytar installation on some machines. If keytar fails on Windows, resolve that before relying on production key storage.

## Install and run

```bash
npm install
npm test
npm start
```

On first launch, enter a short session name. The app will convert it to a slug, scan the configured memory directory for matching files, and add the session to the left sidebar. Later, choose any sidebar item to reopen its transcript and continue from that session.

## How session history works

OpsKit V1 has two local persistence tracks:

1. **OpsKit memory receipts** stay in the configured `/opskit_memory/` folder as plaintext `YYYY-MM-DD_[chat-name].txt` files. These files are the Layer 2 grounding corpus and remain human-editable.
2. **Chat transcripts** are saved separately as JSON under Electron `userData/sessions`. They power the sidebar and preserve the visible conversation history, including prior turns and attachment metadata.

When you reopen a previous session, the app restores its transcript, refreshes matching Layer 2 memory files from the current memory directory, and continues appending new receipts to that session's receipt file.

## API keys

Open **Settings** and paste the Cohere and/or Claude key. Key fields are write-only: after saving, the UI shows only whether a key is stored.

Primary key storage is OS keychain through keytar. If native keytar cannot be installed and you need a temporary encrypted fallback, launch with:

```bash
OPSKIT_ALLOW_SAFESTORAGE_FALLBACK=1 npm start
```

That fallback uses Electron `safeStorage` and stores encrypted blobs in Electron `userData`. It is not plaintext, but the V1 security target should remain keytar/Windows Credential Manager.

## Cohere RISK-01 validation

From the UI, open **Settings** and click **Run Cohere RISK-01 boot test**.

From the CLI:

```bash
COHERE_API_KEY=your_key npm run test:cohere
```

Optional overrides:

```bash
COHERE_MODEL=command-a-03-2025 OPSKIT_QUICK_SETUP=/path/to/OpsKit_Quick_Setup.txt COHERE_API_KEY=your_key npm run test:cohere
```

The test sends `Hello` with Layer 0 plus `OpsKit_Quick_Setup.txt` as the first document, then checks for `Ops Kit ready` and a boot receipt prefix.

## Packaging for Windows

```bash
npm run dist:win
```

The `electron-builder` config produces NSIS and portable artifacts.

## Notes on Cohere v2 system prompts

The V1 spec names Cohere's system field as `preamble`. Cohere's current v2 chat shape uses a `messages` array, where a `system` role replaces the v1 `preamble` parameter. This implementation maps Layer 0 to that v2 system-role message and preserves the native `documents` array for Layer 1 and Layer 2.

## Project structure

```text
assets/
  OpsKit_Quick_Setup.txt          Layer 1 grammar dependency
src/main/
  main.mjs                        Electron lifecycle and IPC
  preload.cjs                     Safe renderer bridge
  adapters/                       Provider adapters
  services/                       Memory, session history, context, settings, key store, file extraction
src/renderer/
  index.html, styles.css, app.js  UI with chat-history sidebar
test/
  *.test.mjs                      Node unit tests
scripts/
  cohere-risk-01.mjs              Raw Cohere viability probe
```

## Current limitations

- V1 responses are non-streaming.
- Sidebar search/delete/export are not implemented yet.
- No vector database, embeddings, telemetry, cloud sync, or third-party services beyond the active provider API endpoint.
- Drag-and-drop file paths can be restricted by some Electron/platform combinations; the **Attach files** button is the reliable path.
