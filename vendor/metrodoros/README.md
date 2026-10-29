# Metrodoros SDK distribution

These 0.1.1 tarballs are built with `scripts/pack-airi-packages.mjs` in the Metrodoros repository. See `manifest.json` for the source commit and SHA-256/SHA-512 integrity. Each file name includes its content hash. Workspace overrides keep transitive SDK imports on the same artifacts.

The browser entry uses IndexedDB. Only Electron main imports `@metrodoros/airi-adapter/desktop`, whose FileStorage requires a Node runtime with SQLite. Regenerate all three packages together when updating the SDK; update package references, overrides, the manifest and lockfile in the same change.
