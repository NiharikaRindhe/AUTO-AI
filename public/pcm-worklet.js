// Batch microphone frames without playing them through the speakers.
class AutoAIPCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.stopped || !channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('autoai-pcm-recorder', AutoAIPCMRecorder);
