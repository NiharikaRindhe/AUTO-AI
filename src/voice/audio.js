export function encodeWav(chunks, sampleRate, targetRate = 16000) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const outputLength = Math.floor(length * targetRate / sampleRate);
  const bytes = new ArrayBuffer(44 + outputLength * 2);
  const view = new DataView(bytes);
  const ascii = (start, text) => [...text].forEach((letter, i) => view.setUint8(start + i, letter.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + outputLength * 2, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, outputLength * 2, true);
  // Average source samples when downsampling, reducing high-frequency aliasing.
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * sampleRate / targetRate);
    const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * sampleRate / targetRate)));
    let value = 0;
    for (let index = start; index < end; index++) value += input[index];
    value = Math.max(-1, Math.min(1, value / (end - start)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

