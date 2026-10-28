import type { PlaybackItem, TextSegment, TextToken } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createSpeechPipeline } from './speech-pipeline'

interface Deferred<T> {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createSegments(texts: string[]) {
  return (tokens: ReadableStream<TextToken>, meta: { streamId: string, intentId: string, turnId?: string }) => {
    void tokens.cancel()
    return new ReadableStream<TextSegment>({
      start(controller) {
        for (const [index, text] of texts.entries()) {
          controller.enqueue({
            turnId: meta.turnId,
            streamId: meta.streamId,
            intentId: meta.intentId,
            segmentId: `${meta.streamId}:${index}`,
            text,
            special: null,
            reason: 'flush',
            createdAt: Date.now(),
          })
        }
        controller.close()
      },
    })
  }
}

function createPlaybackFixture(autoEnd = false) {
  const scheduled: PlaybackItem<string>[] = []
  const active = new Set<string>()
  const endListeners: Array<(event: { item: PlaybackItem<string>, endedAt: number }) => void> = []
  const interruptListeners: Array<(event: { item: PlaybackItem<string>, reason: string, interruptedAt: number }) => void> = []
  const playback = {
    schedule: vi.fn((item: PlaybackItem<string>) => {
      scheduled.push(item)
      active.add(item.id)
      if (autoEnd)
        queueMicrotask(() => emitEnd(item))
    }),
    stopAll: vi.fn(),
    stopByIntent: vi.fn((intentId: string, reason: string) => {
      for (const item of scheduled) {
        if (item.intentId === intentId)
          emitInterrupt(item, reason)
      }
    }),
    stopByOwner: vi.fn((ownerId: string, reason: string) => {
      for (const item of scheduled) {
        if (item.ownerId === ownerId)
          emitInterrupt(item, reason)
      }
    }),
    onStart: vi.fn(),
    onEnd: vi.fn((listener: (event: { item: PlaybackItem<string>, endedAt: number }) => void) => {
      endListeners.push(listener)
    }),
    onInterrupt: vi.fn((listener: (event: { item: PlaybackItem<string>, reason: string, interruptedAt: number }) => void) => {
      interruptListeners.push(listener)
    }),
    onReject: vi.fn(),
  }

  function emitEnd(item: PlaybackItem<string>) {
    if (!active.delete(item.id))
      return
    for (const listener of endListeners)
      listener({ item, endedAt: Date.now() })
  }

  function emitInterrupt(item: PlaybackItem<string>, reason: string) {
    if (!active.delete(item.id))
      return
    for (const listener of interruptListeners)
      listener({ item, reason, interruptedAt: Date.now() })
  }

  return { emitEnd, emitInterrupt, playback, scheduled }
}

function withTimeout<T>(promise: Promise<T>, message: string, ms = 1000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('speech pipeline Metrodoros acceptance', () => {
  it('reports final segmentation before delayed synthesis and playback finish', async () => {
    const synthesis = deferred<string | null>()
    const fixture = createPlaybackFixture()
    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegments(['first chunk']),
      playback: fixture.playback,
      tts: () => synthesis.promise,
    })
    const requestsComplete = deferred<{ intentId: string, streamId: string, ownerId?: string }>()
    const intentEnded = deferred<string>()
    pipeline.on('onSpeechRequestsComplete', event => requestsComplete.resolve(event))
    pipeline.on('onIntentEnd', intentId => intentEnded.resolve(intentId))

    const intent = pipeline.openIntent({ intentId: 'intent-delayed', ownerId: 'owner-delayed' })
    intent.end()

    const event = await withTimeout(requestsComplete.promise, 'final segmentation did not complete before the deadline')
    expect(event).toMatchObject({ intentId: 'intent-delayed', ownerId: 'owner-delayed' })
    expect(fixture.playback.schedule).not.toHaveBeenCalled()

    synthesis.resolve('first audio')
    await waitFor(() => fixture.scheduled.length === 1, 'synthesized audio was not scheduled')
    fixture.emitEnd(fixture.scheduled[0]!)
    await expect(withTimeout(intentEnded.promise, 'intent did not finish after playback')).resolves.toBe('intent-delayed')
  })

  it('seals and drains one owner while leaving another owner running', async () => {
    const firstSynthesis = deferred<string | null>()
    const secondSynthesis = deferred<string | null>()
    const fixture = createPlaybackFixture()
    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegments(['chunk']),
      playback: fixture.playback,
      tts(request, signal) {
        if (request.intentId === 'intent-owner-a') {
          expect(signal.aborted).toBe(false)
          return firstSynthesis.promise
        }
        return secondSynthesis.promise
      },
    })
    const requests = new Map<string, Deferred<void>>()
    pipeline.on('onTtsRequest', (request) => {
      requests.get(request.intentId)?.resolve()
    })
    const secondIntentEnded = deferred<void>()
    pipeline.on('onIntentEnd', (intentId) => {
      if (intentId === 'intent-owner-b')
        secondIntentEnded.resolve()
    })

    const first = pipeline.openIntent({ intentId: 'intent-owner-a', ownerId: 'owner-a' })
    const firstRequested = deferred<void>()
    requests.set('intent-owner-a', firstRequested)
    first.end()
    await withTimeout(firstRequested.promise, 'owner A synthesis did not start')

    const secondRequested = deferred<void>()
    requests.set('intent-owner-b', secondRequested)
    const second = pipeline.openIntent({ intentId: 'intent-owner-b', ownerId: 'owner-b' })
    second.end()

    const stop = pipeline.stopOwner('owner-a')
    let stopped = false
    void stop.then(() => stopped = true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(fixture.playback.stopByOwner).toHaveBeenCalledTimes(1)
    expect(fixture.playback.stopByOwner).toHaveBeenCalledWith('owner-a', 'owner-stopped')
    expect(() => pipeline.openIntent({ ownerId: 'owner-a' })).toThrow('Speech output owner is stopped')

    firstSynthesis.resolve('ignored audio after abort')
    await expect(withTimeout(stop, 'stopOwner did not await ignored-abort synthesis')).resolves.toBe(true)
    await withTimeout(secondRequested.promise, 'owner B did not continue after owner A stopped')
    expect(fixture.playback.stopByOwner).not.toHaveBeenCalledWith('owner-b', expect.any(String))

    secondSynthesis.resolve('owner B audio')
    await waitFor(() => fixture.scheduled.some(item => item.intentId === 'intent-owner-b'), 'owner B playback was not scheduled')
    fixture.emitEnd(fixture.scheduled.find(item => item.intentId === 'intent-owner-b')!)
    await withTimeout(secondIntentEnded.promise, 'owner B intent did not finish')
  })

  it('keeps the first chunk completed and marks the second interrupted on cancellation', async () => {
    const fixture = createPlaybackFixture()
    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegments(['first chunk', 'second chunk']),
      playback: fixture.playback,
      tts: async request => request.text,
    })
    const normalCompletions: string[] = []
    const interrupted: Array<{ text: string, reason: string }> = []
    const intentCanceled = deferred<string>()
    const turnEnded = vi.fn()
    pipeline.on('onPlaybackEnd', event => normalCompletions.push(event.item.text))
    pipeline.on('onPlaybackInterrupt', event => interrupted.push({ text: event.item.text, reason: event.reason }))
    pipeline.on('onIntentCancel', event => intentCanceled.resolve(event.intentId))
    pipeline.on('onIntentEnd', () => turnEnded())
    pipeline.on('onTurnEnd', () => turnEnded())

    const intent = pipeline.openIntent({ intentId: 'intent-second-chunk', turnId: 'turn-second-chunk' })
    intent.end()
    await waitFor(() => fixture.scheduled.length === 1, 'first chunk did not reach playback')
    fixture.emitEnd(fixture.scheduled[0]!)
    await waitFor(() => fixture.scheduled.length === 2, 'second chunk did not reach playback')

    intent.cancel('user-cancel')
    await expect(withTimeout(intentCanceled.promise, 'canceled intent did not settle')).resolves.toBe('intent-second-chunk')

    expect(normalCompletions).toEqual(['first chunk'])
    expect(interrupted).toEqual([{ text: 'second chunk', reason: 'user-cancel' }])
    expect(turnEnded).not.toHaveBeenCalled()
  })

  it('reports unavailable TTS results without scheduling playback completion', async () => {
    const fixture = createPlaybackFixture()
    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegments(['empty chunk', 'failed chunk']),
      playback: fixture.playback,
      tts(request) {
        if (request.sequence === 0)
          return Promise.resolve(null)
        return Promise.reject(new Error('provider failed'))
      },
    })
    const unavailable: Array<{ text: string, reason: 'empty' | 'failed' }> = []
    const intentEnded = deferred<void>()
    const playbackEnd = vi.fn()
    pipeline.on('onTtsUnavailable', event => unavailable.push({ text: event.request.text, reason: event.reason }))
    pipeline.on('onIntentEnd', () => intentEnded.resolve())
    pipeline.on('onPlaybackEnd', () => playbackEnd())

    pipeline.openIntent({ intentId: 'intent-unavailable' }).end()
    await withTimeout(intentEnded.promise, 'intent with unavailable TTS did not settle')

    expect(unavailable).toEqual([
      { text: 'empty chunk', reason: 'empty' },
      { text: 'failed chunk', reason: 'failed' },
    ])
    expect(fixture.playback.schedule).not.toHaveBeenCalled()
    expect(playbackEnd).not.toHaveBeenCalled()
  })

  it('settles cancellation of a queued owner without disturbing the active owner', async () => {
    const fixture = createPlaybackFixture()
    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegments(['active chunk']),
      playback: fixture.playback,
      tts: async request => request.text,
    })
    const started: string[] = []
    const canceled = deferred<string>()
    const activeEnded = deferred<void>()
    pipeline.on('onIntentStart', intentId => started.push(intentId))
    pipeline.on('onIntentCancel', event => canceled.resolve(event.intentId))
    pipeline.on('onIntentEnd', (intentId) => {
      if (intentId === 'intent-active')
        activeEnded.resolve()
    })

    const active = pipeline.openIntent({ intentId: 'intent-active', ownerId: 'active-owner' })
    active.end()
    await waitFor(() => fixture.scheduled.length === 1, 'active owner playback did not start')
    const queued = pipeline.openIntent({ intentId: 'intent-queued', ownerId: 'queued-owner' })
    queued.end()

    await expect(withTimeout(pipeline.stopOwner('queued-owner'), 'queued owner stop did not settle')).resolves.toBe(true)
    await expect(withTimeout(canceled.promise, 'queued owner did not emit cancellation')).resolves.toBe('intent-queued')
    expect(started).toEqual(['intent-active'])
    expect(fixture.playback.stopByOwner).toHaveBeenCalledWith('queued-owner', 'owner-stopped')
    expect(fixture.playback.stopByOwner).not.toHaveBeenCalledWith('active-owner', expect.any(String))

    fixture.emitEnd(fixture.scheduled[0]!)
    await withTimeout(activeEnded.promise, 'active owner did not finish normally')
    expect(started).toEqual(['intent-active'])
  })
})
