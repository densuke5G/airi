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
