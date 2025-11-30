// AI wrapper - respond to explicit questions with canned answers, otherwise use Gemini
const axios = require('axios');
const db = require('../libs/db');
const chatHistory = require('./chatHistory');

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

// Canned responses - only for EXPLICIT questions
function cannedResponse(prompt) {
  const p = String(prompt || '').trim();
  const low = p.toLowerCase();

  // Match "кто" queries (Unicode-aware). Use lookarounds to support Cyrillic.
  const whoRx = /(?<!\p{L})(?:кто\s+(?:такой|такая)|who\s+is|who(?:'|’)s)(?!\p{L})/iu;
  const nameAndreyRx = /(?<!\p{L})(?:андрей|вихт|andrey|viht)(?!\p{L})/iu;
  const nameSandraRx = /(?<!\p{L})(?:сандра|sandra|sandra\s+goslin|sandra\s+viht)(?!\p{L})/iu;
  const nameNayaRx = /(?<!\p{L})(?:naya\s+bay|naya|noya|ней\s+бей|ной\s+бой|ная)(?!\p{L})/iu;

  // ANDREY / VIHT - only if user explicitly asks "who is"
  if (whoRx.test(p) && nameAndreyRx.test(p)) {
    return `👨‍💻 **Андрей Вихт** — создатель и главный разработчик системы VPN Viht, основатель компании Viht. Это грамотный, умный и очень хороший человек, который вложил всю душу в развитие проекта. Узнать больше: https://vihtai.pro`;
  }

  // SANDRA - only if user explicitly asks "who is"
  if (whoRx.test(p) && nameSandraRx.test(p)) {
    return `💖 **Sandra** — помощник и самый любимый человек создателя Andrey Viht. Она поддерживает команду и пользователей, очень тёплый, заботливый и вдохновляющий человек. ✨`;
  }

  // NAYA - only if user explicitly asks "who is"
  if (whoRx.test(p) && nameNayaRx.test(p)) {
    return `🎭 **Naya (Naya Bay)** — прекрасный человек, который является сердцем команды. Всегда смешит, веселит и поддерживает коллектив. Несёт за собой юмор, позитив и стремление помогать. Настоящая звёзда в команде! ⭐`;
  }

  // MODEL - only if explicitly asked "какая модель"
  if (/\b(?:какая\s+модель|какая\s+модель\s+используется|what\s+model|which\s+model)\b/i.test(low)) {
    return `Модель: viht-ai-ftxl-v-1-34`;
  }

  // DOWNLOADS - match a wide range of download requests (Unicode-friendly)
  if (/(?:скач|download|install|установ|загруз|ссылка|где|как|получить)/iu.test(p) && /(?:приложен|app|android|ios|windows|виндовс|скач)/iu.test(p)) {
    return `🔗 **Скачать приложение:**\nhttps://vihtai.pro/downloads\n\nВыбери свою платформу (Android, iOS или Windows), скачай приложение, затем перейди на https://vihtai.pro, авторизуйся через Telegram и создай ключ для вашего устройства.`;
  }

  // KEY/AUTH - only if explicitly asked "ключ" / "создать ключ" / "авторизация"
  if (/\b(ключ|создать\s+ключ|create\s+key|auth|авторизоваться|авторизация)\b/i.test(p)) {
    return `🔑 **Как создать ключ:**\n1. Перейди на https://vihtai.pro\n2. Авторизуйся через Telegram\n3. Выбери подходящее устройство (Android, iOS, Windows)\n4. Создай ключ доступа\n5. Скачай и установи приложение на нужную платформу\n\nГотово! Теперь можешь подключаться к VPN Viht. 🚀`;
  }

  return null;
}

async function sendPrompt(prompt, opts = {}) {
  const userId = opts.authorId || 'unknown';
  
  // Check for canned responses FIRST (only on explicit questions)
  const canned = cannedResponse(prompt);
  if (canned) {
    // Store canned responses in history too for context
    chatHistory.addMessage(userId, 'user', String(prompt));
    chatHistory.addMessage(userId, 'assistant', canned);
    return canned;
  }

  // Otherwise, use Gemini AI
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return vihtError();

  // Get user's conversation history for context
  const userHistory = chatHistory.getHistory(userId);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  // Build conversation with history - STRICT VALIDATION
  const contents = [];
  
  // Add history messages - convert 'assistant' role to 'model' for Gemini API
  for (const h of userHistory) {
    if (h && h.role && h.content) {
      const content = String(h.content || '').slice(0, 4000).trim();
      if (content.length > 0) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : h.role,  // Gemini uses 'model' not 'assistant'
          parts: [{ text: content }]
        });
      }
    }
  }
  
  // Add current user prompt
  const promptText = String(prompt || '').slice(0, 4000).trim();
  if (promptText.length > 0) {
    contents.push({
      role: 'user',
      parts: [{ text: promptText }]
    });
  }
  
  // Validate we have at least the current prompt
  if (contents.length === 0) {
    console.error('No valid content to send');
    return vihtError();
  }
  
  const payload = {
    contents: contents,
    systemInstruction: {
      parts: [{ text: `Ты — Viht, виртуальный помощник проекта Viht. Ты помощник для подключения и работы с VPN Viht, а также искусственный помощник в общении, информации, кодинге, разборе идей и размышлении над темами.

Помогай пользователям:
- Подключиться к VPN Viht
- Скачать и установить приложения (Android, iOS, Windows)
- Создать ключ доступа на https://vihtai.pro
- Ответить на вопросы по кодингу, разработке и техническим темам
- Общаться и помогать с информацией

Помни контекст предыдущих сообщений пользователя — не переспрашивай то, что он уже говорил, и развивай диалог естественно.

Отвечай по-русски, кратко, дружелюбно и по существу. Не добавляй списки опций, если пользователь не спросил. Используй эмодзи умеренно. Не упоминай имя модели, кроме как по прямому вопросу.` }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
  };

  const maxAttempts = 4;
  let attempt = 0;
  let lastErr = null;

  // Validate and sanitize payload before sending
  try {
    // Ensure contents is array with valid structure
    if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
      console.error('Invalid payload: contents must be non-empty array');
      return vihtError();
    }
    
    // Sanitize each message in contents
    for (let i = 0; i < payload.contents.length; i++) {
      const item = payload.contents[i];
      if (!item.role || !item.parts || !Array.isArray(item.parts)) {
        console.error(`Invalid content item [${i}]: missing role or parts`);
        return vihtError();
      }
      // Ensure parts array has text objects
      for (let j = 0; j < item.parts.length; j++) {
        if (!item.parts[j].text) {
          console.error(`Invalid part [${i}][${j}]: missing text field`);
          return vihtError();
        }
        // Limit individual message length to 4000 chars
        item.parts[j].text = String(item.parts[j].text).slice(0, 4000);
      }
    }
    
    // Test JSON serialization
    JSON.stringify(payload);
    console.log('Payload validated. Contents count:', payload.contents.length);
  } catch (e) {
    console.error('Payload validation failed:', e && e.message);
    return vihtError();
  }

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
      const text = response && response.data && response.data.candidates && response.data.candidates[0] && response.data.candidates[0].content && response.data.candidates[0].content.parts && response.data.candidates[0].content.parts[0] && response.data.candidates[0].content.parts[0].text;
      if (text && String(text).trim().length > 0) {
        let out = sanitizeText(text);
        if (out.length > 1800) out = out.slice(0, 1800).trim();
        
        // Store in history for context
        chatHistory.addMessage(userId, 'user', String(prompt));
        chatHistory.addMessage(userId, 'assistant', out);
        
        try { if (db && db.incrementAi) db.incrementAi(); } catch (e) { console.warn('incrementAi failed:', e && e.message); }
        return out;
      }
      return vihtError();
    } catch (e) {
      lastErr = e;
      const status = e && e.response && e.response.status;
      const responseData = e && e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 300) : '';
      console.warn(`AI request attempt ${attempt} failed ${status || e.code || e.message}. Response: ${responseData}`);
      
      if (status === 400) {
        // Log payload for debugging 400 errors
        console.error('400 Error - Payload details:');
        console.error('  Contents count:', payload.contents.length);
        for (let i = 0; i < Math.min(2, payload.contents.length); i++) {
          const item = payload.contents[i];
          console.error(`  Content[${i}]: role=${item.role}, parts=${item.parts.length}, text_length=${item.parts[0].text.length}`);
        }
      }
      
      const shouldRetry = (!status) || status === 429 || (status >= 500 && status < 600);
      if (shouldRetry && attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  console.error('AI ошибка: all attempts failed', lastErr && (lastErr.message || lastErr));
  return vihtError();
}

module.exports = { sendPrompt };
