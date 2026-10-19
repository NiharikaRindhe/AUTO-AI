// Silero probabilities drive turn boundaries. No loudness-based speech decisions.
export class SpeechTurnDetector {
  constructor({ onStart, onEnd, onDuration = () => {} }) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onDuration = onDuration;
    this.reset();
  }

  reset() {
    this.preRoll = [];
    this.frames = [];
    this.candidate = 0;
    this.silentFrames = 0;
    this.active = false;
  }

  push(samples, probabilities, { assistantSpeaking = false } = {}) {
    if (samples.length !== probabilities.length * 512) throw new Error('Speech detector frames do not match microphone audio.');
    for (let index = 0; index < probabilities.length; index++) {
      const frame = samples.slice(index * 512, (index + 1) * 512);
      const probability = probabilities[index];
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid speech probability.');
      if (!this.active) {
        this.preRoll.push(frame);
        if (this.preRoll.length > 12) this.preRoll.shift(); // 384 ms protects first words.
        const threshold = assistantSpeaking ? 0.85 : 0.6;
        const required = assistantSpeaking ? 7 : 5; // More cautious during speaker playback.
        this.candidate = probability >= threshold ? this.candidate + 1 : 0;
        if (this.candidate >= required) {
          this.active = true;
          this.frames = [...this.preRoll];
          this.preRoll = [];
          this.silentFrames = 0;
          this.onStart({ interruption: assistantSpeaking });
        }
      } else {
        this.frames.push(frame);
        this.silentFrames = probability < 0.35 ? this.silentFrames + 1 : 0;
        this.onDuration(this.frames.length * 0.032);
        if (this.frames.length >= 875) this.finish('limit'); // 28 seconds, below API limit.
        else if (this.silentFrames >= 25) this.finish('silence'); // 800 ms of non-speech.
      }
    }
  }

  finish(reason = 'manual') {
    if (!this.active) return false;
    const frames = this.frames;
    this.reset();
    this.onDuration(0);
    this.onEnd({ chunks: frames, seconds: frames.length * 0.032, reason });
    return true;
  }
}
