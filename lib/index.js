/**
 * dsh-stt-input — host half.
 *
 * Transcribes a recorded audio clip through an OpenAI-compatible
 * /v1/audio/transcriptions endpoint (OpenAI Whisper, Groq, …).
 *
 * The client half (lib/client.js) POSTs JSON
 *   { audioBase64, mimeType, model, baseUrl, apiKey, language }
 * to /stt-input/transcribe. This half decodes the base64 audio, builds a
 * multipart/form-data body (Node ≥ 18 global fetch / FormData / Blob) and
 * uploads it to `${baseUrl}/v1/audio/transcriptions`, returning
 *   { ok: true, text }  |  { ok: false, error }
 *
 * The API key is supplied per-request by the client (kept in page memory
 * only) and is never persisted or logged here.
 */

export const name = 'dsh-stt-input';
export const inject = [];

const MAX_BODY = 8 * 1024 * 1024; // audio base64 payload cap (≈ a few minutes of low-bitrate opus)
const REQUEST_TIMEOUT_MS = 120000;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error) {
  if (!error) return String(error);
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '请求超时';
  return error.message || String(error);
}

async function transcribe(args) {
  const a = (args && typeof args === 'object') ? args : {};
  if (!a.audioBase64 || typeof a.audioBase64 !== 'string' || !a.audioBase64) {
    return { ok: false, error: '缺少音频数据（audioBase64）' };
  }
  const apiKey = typeof a.apiKey === 'string' ? a.apiKey.trim() : '';
  if (!apiKey) {
    return { ok: false, error: '未配置 API Key（请在 设置 → 语音输入 中填写）' };
  }
  const baseUrl = String(a.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  const url = baseUrl + '/v1/audio/transcriptions';
  const model = String(a.model || 'whisper-1');
  const mime = String(a.mimeType || 'audio/webm');
  const language = (typeof a.language === 'string' && a.language) ? a.language : '';
  const ext = (mime.includes('mp4') || mime.includes('m4a')) ? 'mp4' : 'webm';

  let bytes;
  try {
    bytes = Uint8Array.from(atob(a.audioBase64), (c) => c.charCodeAt(0));
  } catch (e) {
    return { ok: false, error: '音频数据解码失败' };
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'audio.' + ext);
  form.append('model', model);
  if (language) form.append('language', language);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
      signal: (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined
    });
  } catch (e) {
    return { ok: false, error: '请求失败：' + messageOf(e) };
  }

  let json = null;
  try { json = await response.json(); } catch (e) { json = null; }

  if (!response.ok || !json || typeof json.text !== 'string' || !json.text.trim()) {
    const err = json && json.error
      ? (json.error.message || (typeof json.error === 'string' ? json.error : JSON.stringify(json.error)))
      : ('HTTP ' + response.status);
    return { ok: false, error: err };
  }
  return { ok: true, text: json.text.trim() };
}

export function apply(ctx) {
  // Static install: webServer route (the same convention as dsh-omni-bridge /
  // dsh-session-mover). The client calls POST /stt-input/transcribe.
  ctx.inject(['webServer'], (hostCtx) => {
    const server = hostCtx.webServer;
    if (!server || typeof server.register !== 'function') return;
    server.register({
      kind: 'exact',
      path: '/stt-input/transcribe',
      handler: async (request, response) => {
        try {
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const body = await readJsonBody(request);
          const result = await transcribe(body);
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 500, { ok: false, error: messageOf(error) });
        }
      }
    });
  });
}
