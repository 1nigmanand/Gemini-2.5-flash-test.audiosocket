/**
 * Convert Float32Array audio data to PCM16 format
 * Gemini Live API expects 16-bit PCM audio at 16kHz
 */
export function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
  }
  
  return buffer;
}

/**
 * Resample audio from source sample rate to target sample rate
 * Browser typically captures at 48kHz, but Gemini expects 16kHz
 */
export function resampleAudio(audioBuffer, targetSampleRate = 24000) {
  const offlineContext = new OfflineAudioContext(
    1, // mono
    audioBuffer.duration * targetSampleRate,
    targetSampleRate
  );
  
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  
  return offlineContext.startRendering();
}

/**
 * Convert PCM16 audio data to base64 string for JSON transmission
 */
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 audio response back to ArrayBuffer for playback
 */
export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Play PCM16 audio data through Web Audio API
 */
export async function playAudioData(audioContext, pcm16Data, startTime = 0) {
  // Convert PCM16 to Float32 for Web Audio API
  const view = new DataView(pcm16Data);
  const float32Array = new Float32Array(view.byteLength / 2);
  
  for (let i = 0; i < float32Array.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32Array[i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF);
  }
  
  // Create audio buffer and play
  // Gemini returns audio at 24kHz, so we need to match that sample rate
  const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
  audioBuffer.getChannelData(0).set(float32Array);
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  
  // Schedule playback
  // If startTime is 0 or in the past, play immediately (or as soon as possible)
  const playTime = Math.max(audioContext.currentTime, startTime);
  source.start(playTime);
  
  return { source, duration: audioBuffer.duration, playTime };
}
