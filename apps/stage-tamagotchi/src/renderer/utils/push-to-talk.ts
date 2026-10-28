import { shallowRef } from 'vue'

/** The stage uses these phases to suspend automatic input and show recording progress. */
export type PushToTalkState = 'idle' | 'starting' | 'recording' | 'transcribing' | 'cancelling'

/** Microphone and recorder IO owned by the stage. Restoration never changes the saved microphone preference. */
export interface PushToTalkOperations {
  start: () => Promise<boolean>
  finish: () => Promise<void>
  cancel: () => Promise<void>
  restore: () => Promise<void>
}

/** Serializes one held-button recording, recognition, and microphone restoration, including early releases and failed starts. */
export class PushToTalk {
  readonly state = shallowRef<PushToTalkState>('idle')
  private startPromise?: Promise<boolean>
  private closePromise?: Promise<void>
  private cancelled = false

  constructor(private readonly operations: PushToTalkOperations) {}

  async start() {
    if (this.state.value !== 'idle' || this.closePromise)
      return
    this.cancelled = false
    this.state.value = 'starting'
    const starting = Promise.resolve().then(this.operations.start)
    this.startPromise = starting
    try {
      const started = await starting
      if (!started) {
        await this.cancel()
        return
      }
      if (this.state.value === 'starting')
        this.state.value = 'recording'
    }
    catch (error) {
      await this.cancel()
      throw error
    }
  }

  async finish() {
    await this.close(false)
  }

  async cancel() {
    this.cancelled = true
    if (this.closePromise) {
      // Invalidate a pending recognition without creating a second restoration owner.
      await this.startPromise?.catch(() => false)
      await this.operations.cancel()
      await this.closePromise
      return
    }
    await this.close(true)
  }

  private async close(discard: boolean) {
    if (this.closePromise)
      return this.closePromise
    if (this.state.value === 'idle')
      return
    this.state.value = discard ? 'cancelling' : 'transcribing'
    const closing = (async () => {
      try {
        const started = await this.startPromise?.catch(() => false)
        if (started && !this.cancelled)
          await this.operations.finish()
        else
          await this.operations.cancel()
      }
      finally {
        this.startPromise = undefined
        // Automatic listening can resume during restoration, but new presses wait for closing to finish.
        this.state.value = 'idle'
        await this.operations.restore()
      }
    })()
    this.closePromise = closing
    try {
      await closing
    }
    finally {
      if (this.closePromise === closing)
        this.closePromise = undefined
    }
  }
}
