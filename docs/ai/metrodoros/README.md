# Metrodoros host integration

- [Design snapshot](08.1-design.md)
- [Acceptance and remaining runtime checks](08.1-acceptance.md)
- [Canonical Metrodoros design and package source](https://github.com/densuke5G/Metrodoros/tree/b9032bb567143876ebb31844498afe71e223c60f)

The design snapshot preserves the original design's references; companion Metrodoros documents live in the canonical repository above.

Metrodoros 0.1.1 is installed from repository-local, hash-named tarballs. This keeps a clean AIRI checkout independent of any sibling checkout or personal path. `vendor/metrodoros/manifest.json` records the exact source commit, hashes and package integrity. The desktop-only SDK export uses Node SQLite and is never imported by the browser entry point.
