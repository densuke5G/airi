import { randomUUID } from 'node:crypto'

export class AiriApiError extends Error {
  status
  code
  constructor(status, code, message) {
    super(message)

    this.status = status

    this.code = code
  }
}
export class AiriAdapterClient {
  baseUrl
  bearerToken
  constructor(options) {
    const url = new URL(options.baseUrl || 'http://127.0.0.1:47841')

    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('Zeno URL must be a loopback HTTP origin')

    this.baseUrl = url.origin

    this.bearerToken = options.bearerToken
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`

    const headers = new Headers(options.headers || {})

    headers.set('Authorization', `Bearer ${this.bearerToken}`)

    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const res = await fetch(url, {
      ...options,
      redirect: 'error',
      headers,
      signal: options.signal ?? AbortSignal.timeout(10000),
    })

    const json = await res.json()

    if (!res.ok) {
      const err = json

      throw new AiriApiError(res.status, err.code ?? 'REQUEST_FAILED', err.message ?? 'Request failed')
    }
    return json
  }

  async getHealth() {
    const res = await fetch(`${this.baseUrl}/health`, { redirect: 'error' })

    if (!res.ok)
      throw new Error(`Health check failed with status ${res.status}`)

    return res.json()
  }

  async getSettings() {
    return this.request('/api/v1/settings', { method: 'GET' })
  }

  async patchSettings(params) {
    const requestId = params.request_id || randomUUID()

    return this.request('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        timezone: params.timezone,
        expected_revision: params.expected_revision,
        request_id: requestId,
      }),
    })
  }

  async getSnapshot() {
    return this.request('/api/v1/snapshot', { method: 'GET' })
  }

  invoke(path, method, input) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#'))
      throw new Error('Invalid API path')

    return this.request(`/api/v1${path}`, { method, ...(input ? { body: JSON.stringify(input) } : {}) })
  }

  getNotifications(ack_status = 'unread', offset = 0, limit = 20) {
    return this.request(`/api/v1/notifications?${new URLSearchParams({ ack_status, offset: String(offset), limit: String(limit) })}`)
  }

  getMeetingMute() {
    return this.request('/api/v1/settings/meeting-mute')
  }

  notificationWrite(path, input, expected_revision, request_id = randomUUID(), method = 'POST') {
    return this.request(`/api/v1${path}`, { method, body: JSON.stringify({ ...input, expected_revision, request_id }) })
  }

  acknowledgeNotification(id, expected_revision, request_id) {
    return this.notificationWrite(`/notifications/${encodeURIComponent(id)}/ack`, {}, expected_revision, request_id)
  }

  snoozeNotification(id, input, expected_revision, request_id) {
    return this.notificationWrite(`/notifications/${encodeURIComponent(id)}/snooze`, input, expected_revision, request_id)
  }

  updateMeetingMute(input, expected_revision, request_id) {
    return this.notificationWrite('/settings/meeting-mute', input, expected_revision, request_id, 'PATCH')
  }

  heartbeat(input, expected_revision, request_id) {
    return this.notificationWrite('/clients/heartbeat', input, expected_revision, request_id)
  }

  startHeartbeat(getState, onState, onError) {
    let running = true

    let timer

    const pulse = async () => {
      try {
        const snapshot = await this.getSnapshot()

        if (!running)
          return

        const response = await this.heartbeat(getState(), snapshot.revision)

        if (running)
          onState(response.data)
      }
      catch (error) {
        try {
          if (running)
            onError?.(error)
        }
        catch { /* Keep failures observable without overlapping pulses. */ }
      }
      finally {
        if (running) {
          timer = setTimeout(() => {
            void pulse()
          }, 5000)
        }
      }
    }

    void pulse()

    return () => {
      running = false

      if (timer)
        clearTimeout(timer)
    }
  }

  claimDelivery(input, expected_revision, request_id) {
    return this.notificationWrite('/delivery/claim', input, expected_revision, request_id)
  }

  reportDelivery(input, expected_revision, request_id) {
    return this.notificationWrite('/delivery/report', input, expected_revision, request_id)
  }

  validateDelivery(attempt_id, owner_id, character_generation) {
    return this.request(`/api/v1/delivery/${encodeURIComponent(attempt_id)}/validate?${new URLSearchParams({ owner_id, character_generation: String(character_generation) })}`)
  }

  subscribeEvents(handlers) {
    const controller = new AbortController()

    const headers = {
      Authorization: `Bearer ${this.bearerToken}`,
    }

    if (handlers.lastEventId !== undefined) {
      headers['Last-Event-ID'] = String(handlers.lastEventId)
    }
    (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/v1/events`, {
          headers,
          redirect: 'error',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`Failed to connect to SSE stream: status ${res.status}`)
        }
        const reader = res.body.getReader()

        const decoder = new TextDecoder()

        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            if (!controller.signal.aborted)
              handlers.onDisconnect?.()

            break
          }
          buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')

          if (buffer.length > 131072)
            throw new Error('SSE frame exceeds limit')

          const messages = buffer.split('\n\n')

          buffer = messages.pop() || ''

          for (const rawMessage of messages) {
            if (!rawMessage.trim() || rawMessage.startsWith(':')) {
              continue
              // comment / keepalive
            }
            const lines = rawMessage.split('\n')

            let id = 0

            let event = 'message'

            let dataStr = ''

            for (const line of lines) {
              if (line.startsWith('id:')) {
                id = Number.parseInt(line.slice(3).trim(), 10)
              }
              else if (line.startsWith('event:')) {
                event = line.slice(6).trim()
              }
              else if (line.startsWith('data:')) {
                dataStr += line.slice(5).trim()
              }
            }
            let parsedData = dataStr

            try {
              parsedData = JSON.parse(dataStr)
            }
            catch { }
            if (event === 'meeting_mute.safety') {
              handlers.onMuteSafety?.()
              // Re-read mute; this control signal must not reset the durable cursor.
            }
            else if (event === 'reset') {
              if (handlers.onReset)
                handlers.onReset(parsedData)
            }
            else {
              handlers.onEvent({ id, event, data: parsedData })
            }
          }
        }
      }
      catch (err) {
        if ((!(err instanceof Error) || err.name !== 'AbortError') && handlers.onError) {
          handlers.onError(err instanceof Error ? err : new Error('SSE connection failed'))
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }
}
// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
export { MeetingMuteController } from './meeting-mute.js'
