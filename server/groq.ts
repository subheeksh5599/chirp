// Speech-to-text for live subtitles (speaker console uploads short audio clips).
import { env, HttpError } from './env.js';

export async function transcribe(audio: Uint8Array, mime: string, language?: string): Promise<string> {
  const form = new FormData();
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([audio as BlobPart], { type: mime }), `clip.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.groqKey}` },
    body: form,
  });
  const j = (await r.json()) as { text?: string; error?: { message?: string } };
  if (!r.ok) throw new HttpError(502, `speech-to-text: ${j.error?.message ?? r.status}`);
  return (j.text ?? '').trim();
}
