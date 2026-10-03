// Child process for WeBot's free voice: Kokoro (82M, full precision, CPU). It runs below normal priority
// (set by the parent) so OBS and the server always come first. One line at a time, WAV out.
import { KokoroTTS } from 'kokoro-js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// Full precision is about twice real time on a 4-core i5; the 8-bit model is slower on CPUs like that.
const load = KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu' });
load.then(() => process.send({ type: 'ready' })).catch((error) => process.send({ type: 'failed', error: String(error?.message || error) }));

// 16-bit mono WAV: half the size of the float WAV Kokoro writes, and every browser decodes it.
const wav16 = (samples, rate) => {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
};

// Never outlive the server (on Windows a killed parent doesn't take its children with it).
process.on('disconnect', () => process.exit(0));

let chain = Promise.resolve();
process.on('message', ({ id, text, voice, speed }) => {
  chain = chain.then(async () => {
    try {
      const tts = await load;
      const audio = await tts.generate(text, { voice, speed });
      process.send({ type: 'audio', id, wav: wav16(audio.audio, audio.sampling_rate).toString('base64'), seconds: audio.audio.length / audio.sampling_rate });
    } catch (error) {
      process.send({ type: 'audio', id, error: String(error?.message || error) });
    }
  });
});
