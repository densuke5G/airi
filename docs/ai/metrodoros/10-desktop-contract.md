# Phase 10 desktop boundary contract

This contract defines two main-process modules. Existing MemoryOwner remains the connection and token owner.
No renderer receives a stored token. Electron main receives an entered token only for authentication and explicit storage.

## Credential store

Export `CredentialStore` and the types used by its public methods from credential-store.ts.
The constructor accepts an absolute dedicated directory and an installation ID.
Use Electron safeStorage after app readiness. Use APIs present in the installed Electron 43.4.1 declarations.
On Windows, safeStorage uses OS protection. On Linux, reject basic_text and unavailable providers.

Types:

```ts
export interface CredentialIdentity {
  endpoint: string
  userId: string
  clientId: string
  storeGeneration: string
}
export interface StoredCredential extends CredentialIdentity {
  installationId: string
  token: string
}
export interface CredentialStatus {
  available: boolean
  saved: boolean
}
```

Public asynchronous methods:

- `save(credential: StoredCredential): Promise<void>`
- `load(endpoint: string): Promise<StoredCredential | null>`
- `forget(): Promise<void>`
- `status(): Promise<CredentialStatus>`

The directory belongs to one installation. Store one versioned encrypted record with its identity inside the encrypted payload.
Validate a canonical loopback HTTP origin without userinfo, query, fragment, or non-root path.
Reject another installation, malformed IDs, and another endpoint. Do not reuse a token across aliases or ports.
Do not expose arbitrary paths. Reject symlink files and directory escapes. Use exclusive temporary writes, flush, and atomic replacement.
Serialize save, load, and deletion so a late save cannot resurrect a forgotten credential.
Read limits and schema validation apply before and after decryption. Missing storage returns null. Corruption and unavailable encryption throw finite safe codes.
The status exposes presence and availability only. No token, ciphertext, path, or decryption details enter an error.
Saving credentials is separate from enabling automatic connection. Codex adds that setting and verifies identity before save.

## Desktop launcher

Export `DesktopLauncher`, `LaunchProfile`, and `LaunchResult` from desktop-launcher.ts.

```ts
export interface LaunchProfile {
  enabled: boolean
  nodePath: string
  serverRoot: string
  dataDir: string
  endpoint: string
}
export interface LaunchResult {
  state: 'disabled' | 'existing' | 'started'
}
```

Construct with no arguments. `ensureReady(profile: LaunchProfile, signal?: AbortSignal): Promise<LaunchResult>` performs one serialized startup.
`dispose(): void` cancels owned startup waits and releases listeners. It never kills a server.
Use a 30-second startup deadline, distinct from conversation deadlines. Do not block the Electron renderer startup.
If disabled, return disabled without filesystem or process work.
If the endpoint responds with the expected Metrodoros /health/live and /health/ready shapes, return existing only when ready.
An occupied endpoint with an unrelated response or not-ready server returns a finite conflict or not-ready code. Do not spawn over it.
For a refused loopback connection only, validate all configured absolute local paths. Require an existing setup database and source entry apps/server/src/bootstrap/main.ts.
Spawn the registered Node with an argument array, cwd serverRoot, METRODOROS_DATA_DIR, shell false, windowsHide true, detached true, and ignored stdio.
Use unref so the service can continue after AIRI exits. Do not use process.execPath as an implicit Node path.
Poll health within the deadline. An owned child exit or spawn failure returns a safe code.
Concurrent callers share one launch for the same profile. A changed profile or disposal invalidates late results.
No setup, migration, token generation, privilege changes, random port, forced kill, or shell execution is allowed.
Health is readiness only. Codex separately authenticates the saved identity and synchronizes MemoryOwner before enabling conversation.

## Main integration

The same-window Eventa channel exposes finite settings commands and public status only.
Main serializes settings commands and confirms enabled or changed launch targets with a native dialog.
The three options default off. Disabling persistence deletes the saved token.
Saved identities are checked before the owner opens a generation-specific outbox.
Authentication rejection, store changes, and endpoint changes require explicit registration.
Disconnect cancels pending work and suppresses automatic reconnect for the current run.
The launcher never shuts down the service when AIRI exits.
