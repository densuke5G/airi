# Zeno desktop integration

Date: 2026-11-06
Status: Implemented, with runtime acceptance gaps listed below.
Base: `c1f08d776`, the Metrodoros operations branch.
This change is stacked on `densuke5G/feat/metrodoros-operations`.

## Decision

Zeno owns tasks, events, focus sessions, notification delivery, and meeting mute.
AIRI owns conversation, the active character, user speech activity, and audio output.
The desktop main process owns the HTTP client, encrypted credentials, and durable operation journals.
Renderers use finite Eventa contracts and never receive stored HTTP credentials.
The web settings page explains that desktop transport is required.

## User operations

The real user turn supplies each tool identity.
The adapter derives request IDs from that turn, operation, and canonical input.
It saves the original request before sending it.
A retry reuses that request, including its expected revision.
Model tools include prepare operations and exclude confirmation operations.
A native dialog records the human decision before the adapter sends confirmation.
After a lost confirmation response, the saved decision replays without a second dialog.
The adapter reports the stored API result rather than model-generated success text.

## Notifications and speech

SSE and heartbeat refresh confirmed notices and the server mute state.
The active Stage reports its character generation and actual user speech state.
Unknown speech activity blocks spoken delivery.
The notification runner obtains a server claim and validates it before synthesis.
Stage validates again before each AudioBufferSource starts.

A dedicated private provider request selects one allowed introduction within five seconds.
The current character supplies style context.
Fixed templates preserve the title and time.
This request has no tools and never enters ordinary chat ingestion or memory reporting.
The Stage card and settings list retain the confirmed text without acknowledging it.
Ordinary replies receive only the notice actually presented by the mounted card as temporary context.

New user input, a character change, mute, and disconnect cancel pending notification work.
Known unplayed attempts can return to the original bounded wait.
Partial or uncertain output never repeats automatically.
The server owns Windows fallback and the sixty-second waiting limit.

Effective speech mute is the OR of the original AIRI flag and Zeno meeting mute.
The original flag and microphone settings remain unchanged.
The existing Stage stop path cancels synthesis, the speech pipeline, queued buffers, and active playback.
A failed local mute remains inhibited across heartbeat and reconnect until a confirmed update clears it.

## Verification

- Main IPC tests cover failed mute retention, playback authorization, and invalid commands.
- Chromium tests cover the original mute OR, password input, synchronization state, notification display, and explicit ACK.
- Existing speech session, chat contract, chat context, and Metrodoros owner tests provide regression coverage.
- Zeno tests use actual HTTP and SQLite for duplicate calls, journal recovery, human confirmation, and delivery leases.
- Target builds, workspace typechecks, root typecheck, and root lint run before publication.
- Vishot captures use real shared components with fixed transport fixtures. They do not prove native audio delivery.

## Runtime acceptance gaps

An isolated native build starts the Zeno module successfully.
A real external voice provider has not been used to verify simultaneous normal and notification audio cancellation.
The unit and browser results do not replace that check.
Use the Zeno README procedure with Metrodoros enabled and disabled before release.
No account credentials or production data are required for the automated tests.
