'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || 'Abdelmalik-2026-bot';
const APP_SECRET = process.env.META_APP_SECRET || '';
const seen = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// تجاوز التحقق من الـ Signature أثناء التطوير
function verifySignature(raw, signature, secret = APP_SECRET) {
  return true;
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
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️ OPENAI_API_KEY غير معرف، يتم إرجاع رد افتراضي.');
    return 'شغّال بنجاح!';
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: process.env.SYSTEM_PROMPT || 'أنت مساعد مفيد. أجب باختصار وبنفس لغة المستخدم.' },
          { role: 'user', content: text }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('❌ OpenAI Error Response:', data.error);
      return 'حدث خطأ في خدمة الذكاء الاصطناعي.';
    }

    return data.choices?.[0]?.message?.content || 'عذراً، لم أتمكن من إيجاد رد.';
  } catch (err) {
    console.error('❌ OpenAI Fetch Error:', err);
    return 'حدث خطأ في الاتصال بالذكاء الاصطناعي.';
  }
}

async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    console.error('❌ خطأ: لم يتم ضبط META_PHONE_NUMBER_ID أو META_ACCESS_TOKEN في متغيّرات البيئة!');
    return;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    });

    const resData = await res.json();
    console.log(`📩 WhatsApp API Status (${res.status}):`, JSON.stringify(resData));
  } catch (err) {
    console.error('❌ Send WhatsApp Message Error:', err);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 1. Webhook Verification (GET Request)
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ WEBHOOK_VERIFIED');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    } else {
      console.error('❌ VERIFICATION_FAILED:', { token, expected: VERIFY_TOKEN });
      res.writeHead(403);
      return res.end('Forbidden');
    }
  }

  // 2. Receiving WhatsApp Messages (POST Request)
  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      console.log('📨 POST Body Received:', body);
      const signature = req.headers['x-hub-signature-256'];
      if (!verifySignature(body, signature)) {
        res.writeHead(403);
        return res.end('Invalid Signature');
      }

      // الرد فوراً بـ 200 لـ Meta لمنع الـ Timeout
      res.writeHead(200);
      res.end('EVENT_RECEIVED');

      try {
        const payload = JSON.parse(body || '{}');
        const messages = extractMessages(payload);
        for (const msg of messages) {
          if (!remember(msg.id)) continue;
          console.log(`💬 Received message from ${msg.from}: ${msg.text}`);
          const reply = await createReply(msg.text);
          await sendWhatsAppMessage(msg.from, reply);
        }
      } catch (err) {
        console.error('❌ Payload Processing Error:', err);
      }
    });
    return;
  }

  // Health check endpoint
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('WhatsApp Bot is running!');
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
