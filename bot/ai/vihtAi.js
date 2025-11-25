// Simple AI wrapper - just send prompt to Google Gemini and return response
const axios = require('axios');
const db = require('../libs/db');

function vihtError() {
  return 'В данный момент сервис перегружен. Пожалуйста, попробуйте позже.';
}

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/([\p{L}\p{N}])\s*\n\s*([\p{L}\p{N}])/gu, '$1 $2')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Convert markdown links [text](url) -> url
    .replace(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g, '$1')
    // Remove leftover square brackets
    .replace(/\[([^\]]+)\]/g, '$1')
    // Remove backticks
    .replace(/`/g, '')
    .trim();
}

async function sendPrompt(prompt, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return vihtError();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
    systemInstruction: {
      parts: [{ text: `Ты — Viht, виртуальный помощник проекта Viht. Отвечай по-русски, кратко и дружелюбно. Помогай с подключением к VPN, скачиванием приложений, созданием ключей на https://vihtai.pro/downloads, и отвечай на вопросы по кодингу. Не добавляй списки опций, если не спросят. Используй эмодзи экономно.` }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
  };

  const maxAttempts = 4;
  let attempt = 0;
  let lastErr = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
      if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        let out = sanitizeText(response.data.candidates[0].content.parts[0].text);
        if (out.length > 1800) out = out.slice(0, 1800).trim();
        try { if (db && db.incrementAi) db.incrementAi(); } catch (e) { console.warn('incrementAi failed:', e && e.message); }
        return out;
      }
      return vihtError();
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      console.warn(`AI request attempt ${attempt} failed`, status || e.code || e.message);
      if (status && status >= 500 && status < 600 || !status) {
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 500;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      break;
    }
  }

  console.error('AI ошибка: all attempts failed', lastErr && (lastErr.message || lastErr));
  return vihtError();
}

module.exports = { sendPrompt };
