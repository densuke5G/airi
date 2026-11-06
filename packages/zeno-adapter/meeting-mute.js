/** The AIRI integration supplies its real stop-all-audio path. Original mute and microphone settings are never written. */
export class MeetingMuteController {
  client
  originalSpeechMuted
  stopAllAudio
  meetingMuted = true
  epoch = 0
  synchronized = false
  constructor(client, originalSpeechMuted, stopAllAudio) {
    this.client = client

    this.originalSpeechMuted = originalSpeechMuted

    this.stopAllAudio = stopAllAudio
  }

  get effectiveMuted() {
    return this.meetingMuted || this.originalSpeechMuted()
  }

  disconnected() {
    this.epoch++
    this.synchronized = false
  }

  async synchronize() {
    const epoch = this.epoch

    try {
      const response = await this.client.getMeetingMute()

      if (response.data.enabled || response.data.local_inhibited) {
        this.meetingMuted = true

        await this.stopAllAudio()
      }
      else if (epoch === this.epoch) {
        this.meetingMuted = false
      }

      if (epoch === this.epoch)
        this.synchronized = response.data.synchronized ?? true
    }
    catch (error) {
      this.synchronized = false

      throw error
    }
  }

  async update(enabled, until, expected_revision, request_id) {
    const epoch = ++this.epoch

    this.synchronized = false

    if (enabled) {
      this.meetingMuted = true

      await this.stopAllAudio()
    }
    await this.client.updateMeetingMute({ enabled, until }, expected_revision, request_id)

    // Read the current state rather than unmuting from a possibly old idempotent response.
    if (epoch === this.epoch)
      await this.synchronize()
  }
}
