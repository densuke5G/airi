import { describe, expect, it, vi } from 'vitest'

import { PushToTalk } from './push-to-talk'

describe('push-to-talk microphone ownership', () => {
  it.each([true, false])('restores the original microphone preference %s after recognition', async (enabled) => {
    let streamOpen = enabled
    const transcribed = Promise.withResolvers<void>()
    const recorder = {
      start: vi.fn(async () => {
        streamOpen = true
        return true
      }),
      finish: vi.fn(() => transcribed.promise),
      cancel: vi.fn(async () => {}),
      restore: vi.fn(async () => { streamOpen = enabled }),
    }
    const session = new PushToTalk(recorder)
    await session.start()
    expect(session.state.value).toBe('recording')
    expect(streamOpen).toBe(true)
    const finishing = session.finish()
    expect(session.state.value).toBe('transcribing')
    await session.start()
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(recorder.restore).not.toHaveBeenCalled()
    transcribed.resolve()
    await finishing
    expect(streamOpen).toBe(enabled)
    expect(session.state.value).toBe('idle')
    expect(recorder.finish).toHaveBeenCalledOnce()
    expect(recorder.restore).toHaveBeenCalledOnce()
  })

  it('finishes exactly once when released before microphone preparation completes', async () => {
    const ready = Promise.withResolvers<boolean>()
    const recorder = {
      start: vi.fn(() => ready.promise),
      finish: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      restore: vi.fn(async () => {}),
    }
    const session = new PushToTalk(recorder)
    const starting = session.start()
    const finishing = session.finish()
    const duplicateRelease = session.finish()
    expect(recorder.finish).not.toHaveBeenCalled()
    ready.resolve(true)
    await Promise.all([starting, finishing, duplicateRelease])
    expect(recorder.finish).toHaveBeenCalledOnce()
    expect(recorder.restore).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('idle')
  })

  it('discards a recording on focus loss without sending it to recognition', async () => {
    const recorder = {
      start: vi.fn(async () => true),
      finish: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      restore: vi.fn(async () => {}),
    }
    const session = new PushToTalk(recorder)
    await session.start()
    await session.cancel()
    expect(recorder.finish).not.toHaveBeenCalled()
    expect(recorder.cancel).toHaveBeenCalledOnce()
    expect(recorder.restore).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('idle')
  })

  it('restores microphone ownership after permission is denied', async () => {
    const recorder = {
      start: vi.fn(async () => { throw new Error('Permission denied') }),
      finish: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      restore: vi.fn(async () => {}),
    }
    const session = new PushToTalk(recorder)
    await expect(session.start()).rejects.toThrow('Permission denied')
    expect(recorder.finish).not.toHaveBeenCalled()
    expect(recorder.restore).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('idle')
  })

  it('restores microphone ownership after recognition fails', async () => {
    const recorder = {
      start: vi.fn(async () => true),
      finish: vi.fn(async () => { throw new Error('ASR failed') }),
      cancel: vi.fn(async () => {}),
      restore: vi.fn(async () => {}),
    }
    const session = new PushToTalk(recorder)
    await session.start()
    await expect(session.finish()).rejects.toThrow('ASR failed')
    expect(recorder.restore).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('idle')
  })

  it('cancels pending recognition and restores only once', async () => {
    const transcribed = Promise.withResolvers<void>()
    const recorder = {
      start: vi.fn(async () => true),
      finish: vi.fn(() => transcribed.promise),
      cancel: vi.fn(async () => transcribed.resolve()),
      restore: vi.fn(async () => {}),
    }
    const session = new PushToTalk(recorder)
    await session.start()
    const finishing = session.finish()
    await vi.waitFor(() => expect(recorder.finish).toHaveBeenCalledOnce())
    await session.cancel()
    await finishing
    expect(recorder.cancel).toHaveBeenCalledOnce()
    expect(recorder.restore).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('idle')
  })
})
