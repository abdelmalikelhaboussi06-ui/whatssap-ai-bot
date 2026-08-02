'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const seen = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySignature(raw, signature, secret = process.env.META_APP_SECRET) {
  if (!secret) return process.env.NODE_ENV !== 'production';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return safeEqual(expected, signature);
}

function extractMessages(payload) {
  const result = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        if (message.type === 'text' && message.text?.body) {
          result.push({ id: message.id, from: message.from, text: message.text.body });
        }
      }
    }
  }
  return result;
}

function remember(id) {
  const now = Date.now();
  for (const [key, time] of seen) if (now - time > 3600000) seen.delete(key);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

async function createReply(text) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
      instructions: process.env.SYSTEM_PROMPT || 'أنت مساعد مفيد. أجب باختصار وبنفس لغة المستخدم.',
      input: text,
      max_output_tokens: Number(process.env.MAX_OUTPUT_TOKENS || 500)
    })
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const data = await response.json();
  const reply = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!reply) throw new Error('OpenAI returned no text');
  return reply.slice(0, 4000);
}

async function sendWhatsApp(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } })
  });
  if (!response.ok) throw new Error(`WhatsApp request failed (${response.status})`);
}

async function processPayload(payload) {
  for (const message of extractMessages(payload)) {
    if (!remember(message.id)) continue;
    try {
      const reply = await createReply(message.text);
      await sendWhatsApp(message.from, reply);
    } catch (error) {
      console.error('Message processing error:', error.message);
    }
  }
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'WhatsApp AI bot is running');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const valid = url.searchParams.get('hub.mode') === 'subscribe' &&
      safeEqual(url.searchParams.get('hub.verify_token'), process.env.WEBHOOK_VERIFY_TOKEN);
    return valid ? send(res, 200, url.searchParams.get('hub.challenge') || '') : send(res, 403, 'Forbidden');
  }
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, req.headers['x-hub-signature-256'])) return send(res, 401, 'Invalid signature');
      try {
        const payload = JSON.parse(raw.toString('utf8'));
        send(res, 200, 'EVENT_RECEIVED');
        void processPayload(payload);
      } catch { send(res, 400, 'Invalid JSON'); }
    });
    return;
  }
  send(res, 404, 'Not found');
});

if (require.main === module) {
  const required = ['WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'OPENAI_API_KEY'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) console.warn(`Missing environment variables: ${missing.join(', ')}`);
  server.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));
}

module.exports = { server, safeEqual, verifySignature, extractMessages };
