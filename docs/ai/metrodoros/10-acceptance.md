# Phase 10 desktop acceptance

## Settings

Desktop settings live under AIRI user data in a separate file.
Automatic launch, token storage, and automatic connection start disabled.
Native confirmation binds first enablement and changed launch paths to the requesting window.
Unchanged startup does not repeat that confirmation.
The saved profile contains explicit Node, server, and data paths.
The active memory endpoint completes the launch profile.
The shared memory profile contains no desktop paths.

## Credential boundary

Electron main owns authentication, encrypted storage, and saved identity checks.
The renderer receives settings and credential status only.
Credential storage rejects unsafe endpoints, malformed identities, symlink paths, and unavailable encryption.
Desktop commands use a finite same-window Eventa channel.
Manual connections save credentials only after authentication succeeds and storage is enabled.
Enabling storage later asks for a fresh connection before automatic use.

## Startup and restore

Automatic work waits until conversation and speech hosts both register.
The launcher has a bounded readiness wait and never kills its server.
The launch endpoint must match the selected data directory host and port.
Saved identity checks run before local outbox storage opens.
Outbox namespaces include the store generation.
After restore, an old identity fails before storage opens.
A fresh token can connect to the new generation in a separate namespace.
Explicit disconnect blocks automatic reconnection for the current app run.
Authentication rejection disables automatic connection and persists the registration requirement.
Changing the endpoint requires registration before automatic reuse.
Disabling token storage deletes the saved credential.
Failed replacement storage disables automatic reuse and removes the earlier saved copy when possible.

## Checks

Credential, launcher, and startup tests cover encryption, path safety, redirects, timeout, default-off settings, and startup order.
Memory owner tests cover saved identity mismatch, stale cancellation, fresh manual connection, and token privacy.
The desktop settings absence test confirms browsers without a desktop bridge show no desktop controls.
The desktop Node tests pass: four files and 45 tests.
The focused stage UI run passes: three files and eight tests, including Chromium browser absence coverage.
The app, stage UI, and root TypeScript checks pass. The root check completes 55 tasks.
The standard root lint command reports errors only in pre-existing, untracked `.local-runtime` and `.local-tools` artifacts.
Product source lint passes with zero errors. It retains 682 existing warnings.

## Windows runtime evidence

An isolated acceptance harness used Node 24.19.0, Electron 43.4.1, Windows safeStorage, and a real schema-8 HTTP server.
The first Electron process saved a synthetic authenticated credential through a private named pipe.
The second Electron process received no token environment variable and loaded the encrypted record.
HTTP authentication matched the saved user, client, and store generation. Credential deletion then removed the saved record.
The report contains version numbers and boolean assertions only. It contains no token, ciphertext, or conversation body.

The real AIRI owner acceptance also passes all 25 checks against schema 8.
It covers real HTTP, SQLite, separate conversation and speech hosts, delivery, forget stop acknowledgement, checkpoint advancement, and reconnect.
It does not run a live LLM or TTS.

## Remaining release acceptance

The Windows storage harness verifies the credential boundary across two processes.
The full AIRI startup, service spawn, automatic synchronization, and live voice conversation still need one combined manual acceptance.
Actual sleep/wake, long-running use, and mixed model load are not verified.
Default-off settings allow these operations to remain explicit while that acceptance continues.

## Consolidation key extension, 2026-10-31

The desktop panel can copy the current configured AIRI provider API key into a separate OS-encrypted record after native confirmation.
Only Chat Completions providers with a configured API key and safe base URL are eligible.
Paths must be saved first. Service target changes require saving the key again.
The saved source remains explicit when AIRI provider settings change. It does not refresh the copy silently.

Only an authorized new service spawn receives the decrypted key.
The child receives the key and provider base URL in fixed environment slots. AIRI's environment and command arguments remain unchanged.
Metrodoros rejects a mismatched provider destination before resolving the key.
An existing ready service is reused without changing its environment. Key replacement and deletion take effect after service restart.

Desktop tests pass: six files and 61 tests. Shared owner/UI tests pass: three files and eight tests, including Chromium absence coverage.
The root typecheck completes 55 tasks. The desktop build passes. Changed-file lint passes.
Root lint still includes untracked local runtime/tools and fails. Product source lint has zero errors and 682 existing warnings.

A real Windows harness saved a synthetic key with Electron 43.4.1 safeStorage.
A separate Electron process received no key environment variable and loaded the record.
The actual launcher passed it to a registered Node 24.19.0 child.
That child used Metrodoros's production secret resolver and authenticated to a local synthetic provider endpoint.
The resolver rejected a different destination. The saved record was deleted and the fixture service was closed gracefully.
This proves the OS/process boundary with synthetic data. It does not run a live model or voice conversation.

Sanitized runtime report: [Windows consolidation key](evidence/10-consolidation-key-windows.json).

## Character setup corrections, 2026-10-31

Character creation now sends an explicit first-person pronoun instead of an empty string.
The form accepts 1–20 characters and retains the entered name after a failed request.
Authenticated `no_character` status explains that character selection is pending instead of suggesting an address error.
Background snapshots retain unsaved character and world choices, including a failed bind.
A successful bind releases the draft. Changing the active AIRI Card loads that card's saved mapping.

A real AIRI owner created a character through a temporary schema-8 HTTP server and read the saved pronoun.
The server still rejected an empty pronoun. Existing user data and the running service were not used.
Report: [character setup](evidence/10-character-setup-windows.json).
The focused shared UI/owner run passes 20 tests, including five new Chromium regression cases.

## Cross-app setup and restart, 2026-10-31

A real Electron renderer, Eventa IPC, MemoryOwner, schema-8 HTTP service, SQLite, and Windows safeStorage complete the setup flow.
The dedicated profile uses a synthetic Chat Completions provider and generated credentials. The normal profile and port 47831 remain untouched.

| Flow | Result |
| --- | --- |
| Character/world selection, explicit refresh, bind, settings reload | Passed with retained selections and persisted mapping |
| Fiction-world and real-world chat | Passed through the actual chat window with a displayed provider response |
| New conversation from Settings | Passed. The receiving chat creates and selects its local session |
| Token and separate consolidation key registration | Passed through the settings UI and native confirmation |
| Stopped service, AIRI restart, automatic connection | Passed without token entry or a parent key environment variable |
| Consolidation and later recall | Passed. A user fact becomes active and reaches a new request inside quoted memory data |
| Interrupted startup during host handover | Reproduced before repair. Two new main-process regression tests pass after repair |

Settings previously created a session in another window, leaving the actual chat on its old session.
Main now targets the selected chat window. That renderer confirms stop, creates a session, then activates it.
Expired requests, failed stops, and changed cards retain the prior selection or reject the stale request.
The request has a ten-second deadline. Floating and legacy chat pages register the same handler.

An interrupted host previously consumed the one automatic launch attempt before spawn.
Only a current, non-cancelled launch completion now consumes that attempt. Ordinary launch failures remain bounded.
The Windows start script builds current translations and the desktop app. `-SkipBuild` explicitly reuses the existing build.

Fiction-world membership and the server LLM profile/binding remain public-API setup steps.
Selecting a world in AIRI does not replace its server membership list. A real world requires no fiction membership registration.
Consolidation waits for conversation activity to become idle. Immediate session closure can cancel pending extraction.

The synthetic response proves transport, delivery, storage, and recall. It does not measure model quality or TTS.
The normal Windows start script was syntax-checked. Its build commands ran. Irodori and the normal profile were not launched.
Backup, restore, forgetting, and deletion retain their prior evidence. This GUI run does not repeat those paths.

Report: [Windows cross-app result](evidence/10-cross-app-windows.json).
Focused checks: desktop 63, owner/connection 18, shared settings Chromium 13, chat Chromium 4, and scenario helpers 11 passed.
Root typecheck completes 55 tasks. Desktop build and changed-file lint pass.
Root lint still reports 795 errors in existing local runtime/tool artifacts, with 682 existing warnings.

## Disconnected setup guidance, 2026-11-01

The normal user profile exposed an initial-state gap: memory was enabled, but its token had not been saved across restart.
Character and world lists were empty. Their selectors and creation buttons still allowed operations without an authenticated identity client.
The generic Select also omitted its placeholder at the Reka SelectValue boundary.

Long-term memory now explains the connection requirement beside the character form.
Its navigation button scrolls to the connection section and focuses the existing token input.
Disconnected selectors, creation, and binding stay disabled. Connection loss disables them again without clearing entered names.
Connected empty lists explain creation. Failed world creation preserves its name, matching character creation.
The shared Select forwards its existing placeholder prop to SelectValue.

The user entered the existing token in AIRI. Read-only inspection then confirmed authentication and populated character/world selections.
No production token, API key, or memory body was read into a diagnostic or published artifact.
Production data was not used for visual fixtures or automated creation.

Six new Chromium cases use real Pinia stores and real components. Only the external memory transport is substituted.
The disconnected-operation and placeholder cases both fail before repair. The related settings run passes 18 cases.
Root `pnpm typecheck` completes 55 tasks. `pnpm -F @proj-airi/i18n build` and the desktop build pass.
Root `pnpm lint` still fails on generated local profiles and tool artifacts. No rule or ignore configuration was changed.

Report: [disconnected setup on Windows](evidence/10-disconnected-setup-windows.json).
Visual checks cover Japanese/light, English/dark, and Japanese at 420 px. All three show no horizontal overflow.
