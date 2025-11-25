// Gemini AI wrapper - простой запрос к Google API
const axios = require('axios');
const { useMockAi } = require('../config');
const db = require('../libs/db');

function vihtError() {
  return 'ОШИБКА ПОДКЛЮЧЕНИЯ К СЕРВЕРАМ Viht. Мы уже передали разработчикам — подождите немного, пожалуйста.';
}

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/([\p{L}\p{N}])\s*\n\s*([\p{L}\p{N}])/gu, '$1 $2')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// canned responses for known names, downloads and model query
function cannedResponse(prompt) {
  const p = String(prompt || '').trim();
  const low = p.toLowerCase();

  // Андрей / Viht
  if (/\b(андрей|andrey|andrei|andrey\s+viht|viht|вихт)\b/i.test(p)) {
    return `👨‍💻 Андрей Вихт — создатель и главный разработчик системы VPN Viht, основатель компании Viht. Это грамотный и добрый человек, который вложил душу в проект. Подробнее: https://vihtai.pro`;
  }

  // Sandra
  if (/\b(сандра|sandra|sandra\s+goslin|sandra\s+viht)\b/i.test(p)) {
    return `💖 Sandra — помощник и самый любимый человек создателя, поддерживающая команду и пользователей. Очень тёплый и заботливый человек. 😊`;
  }

  // Naya / Noy / Naya Bay / Ной Бой
  if (/\b(naya\s+bay|naya|noya|ной\s*бой|ной|ная|няя)\b/i.test(p)) {
    return `🎭 Naya (Naya Bay) — весёлый и душевный человек, который поднимает настроение в команде шутками и поддержкой. Всегда рядом, чтобы помочь и рассмешить.`;
  }

  // model question
  if (/\b(какая\s+модель|какая\s+модель\s+используется|what\s+model|which\s+model)\b/i.test(low)) {
    return `Модель: viht-ai-ftxl-v-1-34.`;
  }

  // Downloads queries
  if (/\b(android|плей\s*маркет|play\s*store|скачать\s+андроид|скачать\s+android)\b/i.test(p)) {
    return `📲 Для Android: https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru — скачайте приложение V2RayTUN из Play Маркета.`;
  }
  if (/\b(ios|iphone|ipad|app\s*store|скачать\s+ios|скачать\s+iphone)\b/i.test(p)) {
    return `📱 Для iOS: https://apps.apple.com/ru/app/v2raytun/id6476628951 — загрузите V2RayTUN из App Store.`;
  }
  if (/\b(windows|win|скачать\s+windows|скачать\s+виндовс)\b/i.test(p)) {
    return `💻 Для Windows: https://v2raytunvpn.cc/files/xraysurf.zip — скачайте клиент для Windows.`;
  }

  // How to create key instruction
  if (/\b(ключ|создать\s+ключ|create\s+key|auth|авторизоваться|авторизация)\b/i.test(p)) {
    return `🔑 Чтобы получить ключ: зайдите на https://vihtai.pro, авторизуйтесь через Telegram, выберите подходящее устройство и создайте ключ доступа.`;
  }

  return null;
}

async function sendPrompt(prompt, opts = {}) {
  // quick local canned responses (bypass external API)
  const canned = cannedResponse(prompt);
  if (canned) return canned;

  if (useMockAi) {
    // keep a simple fallback mock
    const q = String(prompt || '').trim().toLowerCase();
    if (!q) return 'Здравствуйте! Чем могу помочь?';
    if (/\b(кто\s+такой\s+viht|viht|вихт)\b/i.test(q)) return '👨‍💻 Viht — команда, создающая быстрые и надёжные VPN‑решения.';
    if (/\b(андрей|andrey)\b/i.test(q)) return '👨‍💻 Андрей Вихт — основатель проекта Viht. Подробнее: https://vihtai.pro';
    if (/\b(сандра|sandra)\b/i.test(q)) return '💖 Sandra — помощник и любимый человек создателя.';
    if (/\b(naya|noya|ной)\b/i.test(q)) return '🎭 Naya — душа команды, всегда поднимет настроение.';
    return 'Принято. Сейчас AI недоступен — уточните запрос.';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return vihtError();

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
        systemInstruction: {
          parts: [{ text: `Ты — Viht, виртуальный помощник проекта Viht. Отвечай по-русски, дружелюбно и по делу. Помогай с подключением к VPN Viht, давай инструкции по скачиванию приложений (Android, iOS, Windows), подсказывай как создать ключ на https://vihtai.pro (авторизация через Telegram). Помогаешь также с кодингом, разбором и идеями. Не упоминай внутреннее имя модели в каждом ответе — только если прямо спросят "какая модель". Используй эмодзи, делай ответ понятным и коротким.` }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
    );

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      let out = sanitizeText(response.data.candidates[0].content.parts[0].text);
      if (out.length > 1800) out = out.slice(0, 1800).trim();
      try { if (db && db.incrementAi) db.incrementAi(); } catch (e) {}
      return out;
    }

    return vihtError();
  } catch (e) {
    console.error('❌ AI ошибка:', e && e.message ? e.message : e);
    return vihtError();
  }
}

module.exports = { sendPrompt };
