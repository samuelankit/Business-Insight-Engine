import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

const execFileAsync = promisify(execFile);

const RNNOISE_FRAME_SIZE = 480;
const RNNOISE_SAMPLE_RATE = 48000;

let rnnoiseModule: { Rnnoise: { load: () => Promise<unknown> } } | null = null;
let rnnoiseInstance: {
  createDenoiseState: () => { processFrame: (f: Float32Array) => void; destroy: () => void };
} | null = null;

async function getRnnoiseInstance() {
  if (rnnoiseInstance) return rnnoiseInstance;
  if (!rnnoiseModule) {
    try {
      rnnoiseModule = await import("@shiguredo/rnnoise-wasm") as typeof rnnoiseModule;
    } catch {
      return null;
    }
  }
  if (!rnnoiseModule) return null;
  try {
    rnnoiseInstance = (await rnnoiseModule.Rnnoise.load()) as typeof rnnoiseInstance;
  } catch {
    return null;
  }
  return rnnoiseInstance;
}

function denoiseFloat32(rnnoise: typeof rnnoiseInstance, pcmFloat32: Float32Array): Float32Array {
  if (!rnnoise) return pcmFloat32;

  const denoiseState = rnnoise.createDenoiseState();
  const output = new Float32Array(pcmFloat32.length);
  const numFrames = Math.floor(pcmFloat32.length / RNNOISE_FRAME_SIZE);

  for (let i = 0; i < numFrames; i++) {
    const frame = pcmFloat32.slice(i * RNNOISE_FRAME_SIZE, (i + 1) * RNNOISE_FRAME_SIZE);
    denoiseState.processFrame(frame);
    output.set(frame, i * RNNOISE_FRAME_SIZE);
  }

  const remaining = pcmFloat32.length - numFrames * RNNOISE_FRAME_SIZE;
  if (remaining > 0) {
    const lastFrame = new Float32Array(RNNOISE_FRAME_SIZE);
    lastFrame.set(pcmFloat32.slice(numFrames * RNNOISE_FRAME_SIZE));
    denoiseState.processFrame(lastFrame);
    output.set(lastFrame.slice(0, remaining), numFrames * RNNOISE_FRAME_SIZE);
  }

  denoiseState.destroy();
  return output;
}

function float32ToPcm16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]!));
    int16[i] = Math.round(clamped * 32767);
  }
  return int16;
}

function writeWavHeader(numSamples: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return header;
}

export async function preprocessAudio(audioBuffer: Buffer): Promise<Buffer> {
  const id = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `voice_in_${id}`);
  const outputPath = join(tmpdir(), `voice_out_${id}.wav`);

  try {
    await writeFile(inputPath, audioBuffer);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-ar", String(RNNOISE_SAMPLE_RATE),
      "-ac", "1",
      "-f", "wav",
      outputPath,
    ]);

    const wavBuffer = await readFile(outputPath);

    if (wavBuffer.length < 44) return audioBuffer;

    const dataStart = 44;
    const pcmBuffer = wavBuffer.slice(dataStart);
    const int16Array = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32[i] = int16Array[i]! / 32768.0;
    }

    const rnnoise = await getRnnoiseInstance();
    const denoised = rnnoise ? denoiseFloat32(rnnoise, float32) : float32;

    const pcm16 = float32ToPcm16(denoised);
    const wavHeader = writeWavHeader(pcm16.length, RNNOISE_SAMPLE_RATE, 1, 16);
    const pcmBytes = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    const outputWav = Buffer.concat([wavHeader, pcmBytes]);

    return outputWav;
  } catch {
    return audioBuffer;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export function validateAudioBuffer(buffer: Buffer): boolean {
  if (buffer.length < 100) return false;

  const isWav = buffer.slice(0, 4).toString("ascii") === "RIFF";
  const isM4a = buffer.slice(4, 8).toString("ascii") === "ftyp";
  const isOgg = buffer.slice(0, 4).toString("ascii") === "OggS";
  const isMp3 = buffer[0] === 0xff && ((buffer[1]! & 0xe0) === 0xe0);
  const isWebM = buffer[0] === 0x1a && buffer[1] === 0x45;

  return isWav || isM4a || isOgg || isMp3 || isWebM;
}
