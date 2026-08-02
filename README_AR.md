# روبوت WhatsApp بالذكاء الاصطناعي

مشروع جاهز لربط WhatsApp Cloud API بخدمة OpenAI. لا يحتوي على أي أسرار.

## 1) GitHub

أنشئ مستودعًا خاصًا باسم `whatsapp-ai-bot`، فك ضغط الأرشيف، ثم ارفع **محتويات المجلد** إلى المستودع. لا ترفع ملف `.env` ولا أي مفتاح سري.

## 2) Railway

اختر **New Project → Deploy from GitHub repo** ثم المستودع. في **Variables** أضف القيم الموضحة أدناه. أنشئ نطاقًا عامًا من **Settings → Networking → Generate Domain**. نقطة فحص الصحة هي `/health`، والتطبيق يستخدم `PORT` الذي توفره Railway تلقائيًا.

## 3) متغيرات البيئة المطلوبة

- `WEBHOOK_VERIFY_TOKEN`: قيمة طويلة عشوائية تختارها أنت، وتكتب القيمة نفسها في Meta.
- `META_APP_SECRET`: من Meta App Dashboard → App settings → Basic.
- `WHATSAPP_ACCESS_TOKEN`: رمز وصول دائم لمستخدم نظام بصلاحيات WhatsApp (الرمز المؤقت ينتهي).
- `WHATSAPP_PHONE_NUMBER_ID`: من WhatsApp → API Setup؛ ليس رقم الهاتف نفسه.
- `OPENAI_API_KEY`: مفتاح OpenAI API.

اختيارية: `OPENAI_MODEL`، `SYSTEM_PROMPT`، `MAX_OUTPUT_TOKENS`، `META_GRAPH_VERSION`. راجع `.env.example`.

## 4) Meta Webhook

في Meta Developers → WhatsApp → Configuration، استخدم:

- Callback URL: `https://YOUR-RAILWAY-DOMAIN/webhook`
- Verify token: القيمة نفسها في `WEBHOOK_VERIFY_TOKEN`

بعد نجاح التحقق، اشترك في حقل **messages**. تأكد أن التطبيق في وضع Live وأن رقم الهاتف والمستلم مسموحان حسب حالة حساب Meta.

## فحص محلي اختياري

يتطلب Node.js 20 أو أحدث:

```bash
npm test
```

تشغيل الخادم يحتاج متغيرات البيئة، ثم:

```bash
npm start
```

## الأمان

يُتحقق من توقيع `X-Hub-Signature-256` عند ضبط `META_APP_SECRET`. في وضع الإنتاج يجب ضبطه دائمًا. لا تنشر لقطات شاشة للمفاتيح ولا تسجل محتوى الأسرار في السجلات. إذا انكشف مفتاح، ألغِه وأنشئ بديلًا فورًا.
