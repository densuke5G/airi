/** Identity metadata for one saved desktop connection. */
export interface DesktopCredentialIdentity {
  endpoint: string
  userId: string
  clientId: string
  storeGeneration: string
}

/** Main passes this record to MemoryOwner only after reading encrypted storage. */
export interface DesktopStoredCredential extends DesktopCredentialIdentity {
  installationId: string
  token: string
}
