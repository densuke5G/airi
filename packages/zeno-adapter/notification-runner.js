// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import { AiriApiError } from './index.js'

/** Only fresh, server-claimed deliveries reach the speech host. Recovery lists never enter ordinary chat or memory. */
export class NotificationRunner {
  client
  host
  busy = false
  again = false
  active = true
  generation = 0
  drained = []
  constructor(client, host) {
    this.client = client

    this.host = host
  }

  async refresh() {
    if (!this.active)
      return

    if (this.busy) {
      this.again = true

      return
    }
    this.busy = true

    try {
      do {
        this.again = false

        const owner = this.host.state()

        const generation = this.generation

        if (!owner.active)
          return

        const inbox = await this.client.getNotifications('unread', 0, 100)

        for (const n of inbox.data.items.sort((a, b) => Number(b.source_kind === 'focus') - Number(a.source_kind === 'focus'))) {
          if (!this.active || generation !== this.generation)
            return

          if (n.status !== 'pending' || n.presentation_policy !== 'normal')
            continue

          if (!n.deliveries.some(d => d.channel === 'airi_text' && d.state !== 'pending')) {
            const text = await this.claim(n, 'airi_text', owner)

            if (text) {
              const allowed = await this.authorize(text, owner)

              if (allowed) {
                await this.host.display(n)

                await this.report(text, owner, 'displayed')
              }
              else {
                await this.report(text, owner, 'suppressed')
              }
            }
          }
          if (n.deliveries.some(d => d.channel === 'airi_speech' && d.state !== 'pending'))
            continue

          const speech = await this.claim(n, 'airi_speech', owner)

          if (!speech)
            continue

          const authorize = async () => this.active && generation === this.generation && await this.authorize(speech, owner)

          if (!await authorize()) {
            await this.report(speech, owner, 'suppressed')

            continue
          }
          let result = 'unknown'

          try {
            result = await this.host.speak(speech, authorize)
          }
          catch {
            await this.host.stop()
          }
          await this.report(speech, owner, result)
        }
      } while (this.again && this.active)
    }
    finally {
      this.busy = false

      for (const finish of this.drained.splice(0))
        finish()
    }
  }

  async claim(n, channel, owner) {
    try {
      const snapshot = await this.client.getSnapshot()

      return (await this.client.claimDelivery({ notification_id: n.id, channel, owner_id: owner.owner_id, character_generation: owner.character_generation }, snapshot.revision)).data
    }
    catch (error) {
      if (error instanceof AiriApiError && [403, 409].includes(error.status))
        return null

      throw error
    }
  }

  async authorize(claim, owner) {
    const state = this.host.state()

    if (state.owner_id !== owner.owner_id || state.character_generation !== owner.character_generation || !state.active)
      return false

    return (await this.client.validateDelivery(claim.delivery.attempt_id, owner.owner_id, owner.character_generation)).data.allowed
  }

  async report(claim, owner, state) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const snapshot = await this.client.getSnapshot()

        await this.client.reportDelivery({ attempt_id: claim.delivery.attempt_id, owner_id: owner.owner_id, character_generation: owner.character_generation, state }, snapshot.revision)

        return
      }
      catch (error) {
        if (error instanceof AiriApiError && error.status === 409 && retry === 0)
          continue

        throw error
      }
    }
  }

  async invalidate() {
    this.generation++
    const done = this.busy ? new Promise(resolve => this.drained.push(resolve)) : Promise.resolve()
    await this.host.stop()
    await done
  }

  async stop() {
    this.active = false
    await this.invalidate()
  }
}
