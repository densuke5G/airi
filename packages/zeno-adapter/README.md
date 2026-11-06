# Zeno adapter

This private workspace package connects the AIRI desktop main process to a local Zeno service.
It contains generated runtime files, standalone contract declarations, model tool schemas, and source provenance.

## Use

Import `AiriAdapterClient` from `@zeno/airi-adapter` in the desktop main process.
Use `ConversationTools` for user-requested operations and `NotificationRunner` for claimed deliveries.
Renderer code imports only the contract types and the finite Eventa facade.
The package requires Node crypto and does not run in a browser.

## Update

Build the Zeno workspace first.
Run `node scripts/export-airi.mjs <absolute AIRI packages/zeno-adapter path>` from Zeno.
In AIRI, run `pnpm exec eslint --fix packages/zeno-adapter` to apply repository formatting.
Check `provenance.json`, run the related tests, and rebuild stage-tamagotchi.
Keep Node ESM file extensions in generated runtime imports.

## Boundaries

Zeno owns task, event, focus, notification, and mute state.
The main process stores pairing credentials and request journals with OS encryption.
A notification cannot invoke conversation tools or approve a confirmation.
Do not use this package to bypass the existing memory or speech gates.
