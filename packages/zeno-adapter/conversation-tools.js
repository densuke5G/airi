import { createHash } from 'node:crypto'

const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value)

function requestId(key) {
  const bytes = createHash('sha256').update(key).digest()
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = bytes.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
/** A user turn owns request identities. Notification generation cannot acquire write tools or user confirmations. */
export class ConversationTools {
  client
  definitions
  storage
  confirm
  calls = new Map()
  constructor(client, definitions, storage, confirm) {
    this.client = client

    this.definitions = definitions

    this.storage = storage

    this.confirm = confirm
  }

  async execute(operation, input, turnId, origin) {
    if (origin !== 'user')
      throw new Error('Notifications cannot invoke conversation tools')

    const definition = this.definitions.find(d => d.operation === operation)

    if (!definition)
      throw new Error('Tool is unavailable')

    if (!turnId)
      throw new Error('An active user turn is required')

    const fingerprint = canonical({ operation, input })

    const key = requestId(`${turnId}:${fingerprint}`)

    const old = this.calls.get(key)

    if (old)
      return old

    const run = this.invoke(definition, input, key, fingerprint)

    this.calls.set(key, run)

    try {
      return await run
    }
    finally {
      this.calls.delete(key)
    }
  }

  async invoke(d, input, key, fingerprint) {
    let saved = null

    const raw = await this.storage.get(key)

    if (raw)
      saved = JSON.parse(raw)

    if (saved && saved.fingerprint !== fingerprint)
      throw new Error('Tool identity conflict')

    if (saved?.result !== undefined)
      return saved.result

    if (!saved) {
      const fields = { ...input }

      let path = d.path.replace('/api/v1', '')

      for (const field of d.pathFields) {
        if (typeof fields[field] !== 'string')
          throw new Error('Missing target')

        path = path.replace(`{${field}}`, encodeURIComponent(fields[field]))

        delete fields[field]
      }
      if (d.method === 'GET') {
        const query = new URLSearchParams()

        for (const [name, value] of Object.entries(fields)) {
          if (!d.queryFields.includes(name))
            throw new Error('Unknown query field')

          if (value !== undefined)
            query.set(name, String(value))
        }
        if (query.size)
          path += `?${query}`
      }
      const revision = d.method === 'GET' ? 0 : (await this.client.getSnapshot()).revision

      saved = { fingerprint, path, method: d.method, ...(d.method === 'GET' ? {} : { body: { ...fields, request_id: key, expected_revision: revision } }) }

      await this.storage.set(key, JSON.stringify(saved))
    }
    let response = saved.confirmation ? await this.client.invoke(saved.confirmation.path, 'POST', saved.confirmation.body) : await this.client.invoke(saved.path, saved.method, saved.body)

    if (d.confirmation && !saved.confirmation) {
      const prepared = response.data

      if (!await this.confirm(d.confirmation, response.data)) {
        const result = { cancelled: true }

        await this.storage.set(key, JSON.stringify({ ...saved, result }))

        return result
      }
      const confirmPath = d.confirmation === 'planning' ? '/planning/confirm' : '/focus/switch/confirm'

      saved = { ...saved, confirmation: { path: confirmPath, body: { confirmation_id: prepared.confirmation_id, approved: true, expected_revision: response.revision, request_id: requestId(`${key}:confirm`) } } }

      // Persist the actual human decision before sending. A lost confirm response replays this exact request without asking again.
      await this.storage.set(key, JSON.stringify(saved))

      response = await this.client.invoke(confirmPath, 'POST', saved.confirmation.body)
    }
    // The request journal is already durable. If a large result cannot be cached, retry replays that request on Zeno.
    try {
      await this.storage.set(key, JSON.stringify({ ...saved, result: response }))
    }
    catch { }
    return response
  }
}
