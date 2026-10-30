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
