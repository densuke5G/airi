# Metrodoros host integration

- [Design snapshot](08.1-design.md)
- [Acceptance and remaining runtime checks](08.1-acceptance.md)
- [Canonical Metrodoros design and package source](https://github.com/densuke5G/Metrodoros/tree/b9032bb567143876ebb31844498afe71e223c60f)

The design snapshot preserves the original design's references; companion Metrodoros documents live in the canonical repository above.

Metrodoros 0.1.1 is installed from repository-local, hash-named tarballs. This keeps a clean AIRI checkout independent of any sibling checkout or personal path. `vendor/metrodoros/manifest.json` records the exact source commit, hashes and package integrity. The desktop-only SDK export uses Node SQLite and is never imported by the browser entry point.

## Worlds and everyday conversations

For everyday conversations, select **Real world (everyday use)** in long-term memory settings. Then bind the AIRI Card and world.
The server creates this world during setup. No new world or character membership is required for this world.
Character access and client permissions still apply.

New worlds created in AIRI are fiction worlds. Their names do not determine their realm.
A fiction world named `real world` still requires character membership through the server API.
See the [Metrodoros setup guide](https://github.com/densuke5G/Metrodoros/blob/feature/10-operations-and-verification/README.md#キャラクターとワールド).

Authenticated setup controls remain available after a conversation synchronization failure.
Fresh conversations are marked private before their first memory attempt, including a failed attempt.
Retries use this saved marker. Existing ordinary history still requires a new conversation.
If the marker cannot be saved, preparation stops before a server session opens.

## Temporary connection failures

A temporary network failure or HTTP 429, 503, or 504 pauses memory output and starts automatic synchronization retries.
The retries keep the authenticated bridge, session, private marker, and pending event IDs. They use the existing capped backoff policy.
New output is allowed only after notification changes and their checkpoint are acknowledged.
If forgetting invalidates an acknowledgment, synchronization restarts from the last acknowledged checkpoint and applies the fresh reset first.

An interrupted reply does not replay automatically. After synchronization returns, continue in the same conversation or resend the failed message.
Authentication failures, changed stores, and unconfirmed output stops require explicit recovery. Disconnecting or changing settings cancels pending retries.
