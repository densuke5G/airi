import process from 'node:process'

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { FileStorage } from '@metrodoros/airi-adapter/desktop'

/** Electron Node mode -> FileStorage -> SQLite write, rollback, and reopen. */
if (!process.versions.electron)
  throw new Error('Run this smoke check with Electron and ELECTRON_RUN_AS_NODE=1')

const parent = await realpath(tmpdir())
const directory = await mkdtemp(join(parent, 'airi-memory-sqlite-'))
let result
try {
  const path = join(directory, 'outbox.sqlite')
  const storage = new FileStorage(path)
  await storage.transact(state => state.excludedSourceIds.push('fixture-source'))
  let rollback = false
  try {
    await storage.transact((state) => {
      state.excludedSourceIds.push('must-rollback')
      throw new Error('Expected fixture rollback')
    })
  }
  catch {
    rollback = true
  }
  const restored = await new FileStorage(path).read()
  if (!rollback || !restored.excludedSourceIds.includes('fixture-source') || restored.excludedSourceIds.includes('must-rollback'))
    throw new Error('SQLite persistence smoke check failed')
  result = { electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, write: true, rollback: true, reopen: true }
  if (process.argv[2])
    await writeFile(resolve(process.argv[2]), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
finally {
  const actual = await realpath(directory)
  if (dirname(actual) !== parent || !actual.startsWith(join(parent, 'airi-memory-sqlite-')))
    throw new Error('Unexpected smoke-check directory')
  await rm(actual, { recursive: true })
}
