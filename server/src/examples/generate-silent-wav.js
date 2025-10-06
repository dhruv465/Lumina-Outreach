
const fs = require('fs');
const path = require('path');

function createSilentWav(duration, sampleRate) {
  const numSamples = duration * sampleRate;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(fileSize + 8);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Sub-chunk size
  buffer.writeUInt16LE(1, 20); // Audio format (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Audio data (silence)
  for (let i = 44; i < fileSize + 8; i += 2) {
    buffer.writeInt16LE(0, i);
  }

  return buffer;
}

const silentWav = createSilentWav(1, 16000);
const outputPath = path.join(__dirname, 'test-data', 'test-sample-en.wav');
fs.writeFileSync(outputPath, silentWav);

console.log(`Silent WAV file created at ${outputPath}`);
