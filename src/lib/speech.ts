/**
 * Romanian Text-to-Speech engine.
 * Primary: ElevenLabs server-side proxy (/api/tts) for expressive, natural Romanian speech.
 * Automatic fallback: browser Web Speech API (speechSynthesis) when ElevenLabs is unavailable.
 */

export type SpeechSupport = 'unsupported' | 'no-romanian-voice' | 'ready' | 'elevenlabs';
export type VoiceKey = 'warm' | 'calm';

export interface TtsStatus {
  elevenLabsConfigured: boolean;
  voices: Array<{ key: VoiceKey; label: string }>;
}

const DEFAULT_VOICES: Array<{ key: VoiceKey; label: string }> = [
  { key: 'warm', label: 'Warm & Clear' },
  { key: 'calm', label: 'Calm & Steady' },
];

let ttsStatusCache: TtsStatus | null = null;
let ttsStatusPromise: Promise<TtsStatus> | null = null;
let selectedVoice: VoiceKey = 'warm';
const audioBlobCache = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;
let activeCancelCallback: (() => void) | null = null;
const voiceChangeListeners = new Set<() => void>();

export function getSelectedVoice(): VoiceKey {
  return selectedVoice;
}

export function setSelectedVoice(voice: VoiceKey): void {
  selectedVoice = voice;
  for (const listener of voiceChangeListeners) listener();
}

export function subscribeVoiceChange(listener: () => void): () => void {
  voiceChangeListeners.add(listener);
  return () => voiceChangeListeners.delete(listener);
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function findRomanianVoice(): SpeechSynthesisVoice | undefined {
  if (!speechSupported()) return undefined;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === 'ro-ro') ??
    voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ro'))
  );
}

export function getSupport(): SpeechSupport {
  if (ttsStatusCache?.elevenLabsConfigured) return 'elevenlabs';
  if (!speechSupported()) return 'unsupported';
  return findRomanianVoice() ? 'ready' : 'no-romanian-voice';
}

export async function checkTtsStatus(): Promise<TtsStatus> {
  if (ttsStatusCache) return ttsStatusCache;
  if (ttsStatusPromise) return ttsStatusPromise;
  ttsStatusPromise = (async () => {
    try {
      const res = await fetch('/api/tts', { method: 'GET' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('application/json')) {
        return { elevenLabsConfigured: false, voices: DEFAULT_VOICES };
      }
      const data = (await res.json()) as { configured?: boolean; voices?: Array<{ key: VoiceKey; label: string }> };
      const status: TtsStatus = {
        elevenLabsConfigured: Boolean(data.configured),
        voices: Array.isArray(data.voices) && data.voices.length > 0 ? data.voices : DEFAULT_VOICES,
      };
      ttsStatusCache = status;
      return status;
    } catch {
      return { elevenLabsConfigured: false, voices: DEFAULT_VOICES };
    } finally {
      ttsStatusPromise = null;
    }
  })();
  return ttsStatusPromise;
}

/** Placeholders like [your name] should not be read aloud letter by letter; leave a pause instead. */
export function speakableText(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ', ').replace(/\s+/g, ' ').trim();
}

export function stopSpeaking(): void {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  if (activeCancelCallback) {
    const cb = activeCancelCallback;
    activeCancelCallback = null;
    cb();
  }
  if (speechSupported()) window.speechSynthesis.cancel();
}

function speakWithBrowser(text: string, opts: { slow?: boolean; onEnd?: () => void }): boolean {
  if (!speechSupported()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(speakableText(text));
  utterance.lang = 'ro-RO';
  const voice = findRomanianVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = opts.slow ? 0.7 : 0.95;
  utterance.onend = () => opts.onEnd?.();
  utterance.onerror = () => opts.onEnd?.();
  synth.speak(utterance);
  return true;
}

/** Speak Romanian text via ElevenLabs when available, falling back smoothly to browser speechSynthesis. */
export async function speakRomanianAsync(
  text: string,
  opts: { slow?: boolean; voice?: VoiceKey; onStart?: () => void; onEnd?: () => void },
): Promise<'elevenlabs' | 'browser' | null> {
  stopSpeaking();
  const clean = speakableText(text);
  if (!clean) {
    opts.onEnd?.();
    return null;
  }

  const status = await checkTtsStatus();
  const voice = opts.voice ?? selectedVoice;

  if (status.elevenLabsConfigured) {
    const cacheKey = `${voice}:${opts.slow ? 'slow' : 'normal'}:${clean}`;
    try {
      let objectUrl = audioBlobCache.get(cacheKey);
      if (!objectUrl) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: clean,
            speed: opts.slow ? 'slow' : 'normal',
            voice,
          }),
        });
        if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('Empty TTS audio');
        objectUrl = URL.createObjectURL(blob);
        audioBlobCache.set(cacheKey, objectUrl);
      }

      const audio = new Audio(objectUrl);
      activeAudio = audio;
      activeCancelCallback = () => opts.onEnd?.();

      audio.onended = () => {
        if (activeAudio === audio) {
          activeAudio = null;
          activeCancelCallback = null;
        }
        opts.onEnd?.();
      };
      audio.onerror = () => {
        if (activeAudio === audio) {
          activeAudio = null;
          activeCancelCallback = null;
        }
        opts.onEnd?.();
      };

      opts.onStart?.();
      await audio.play();
      return 'elevenlabs';
    } catch {
      // Seamless fallback to built-in browser speech if ElevenLabs quota/network fails.
    }
  }

  if (speakWithBrowser(clean, { slow: opts.slow, onEnd: opts.onEnd })) {
    opts.onStart?.();
    return 'browser';
  }

  opts.onEnd?.();
  return null;
}

/** Synchronous compatibility helper preserved for existing callers/tests. */
export function speakRomanian(text: string, opts: { slow?: boolean; onEnd?: () => void }): boolean {
  return speakWithBrowser(text, opts);
}
