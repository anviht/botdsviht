// Test cannedResponse logic locally without calling external AI
// This duplicates the cannedResponse logic from bot/ai/vihtAi.js

function cannedResponse(prompt) {
  const p = String(prompt || '').trim();
  const low = p.toLowerCase();

  // Unicode-aware who/name detection (Cyrillic-safe)
  const whoRx = /(?<!\p{L})(?:кто\s+(?:такой|такая)|who\s+is|who(?:'|’)s)(?!\p{L})/iu;
  const nameAndreyRx = /(?<!\p{L})(?:андрей|вихт|andrey|viht)(?!\p{L})/iu;
  const nameSandraRx = /(?<!\p{L})(?:сандра|sandra|sandra\s+goslin|sandra\s+viht)(?!\p{L})/iu;
  const nameNayaRx = /(?<!\p{L})(?:naya\s+bay|naya|noya|ней\s+бей|ной\s+бой|ная)(?!\p{L})/iu;

  if (whoRx.test(p) && nameAndreyRx.test(p)) return `ANDREY`;
  if (whoRx.test(p) && nameSandraRx.test(p)) return `SANDRA`;
  if (whoRx.test(p) && nameNayaRx.test(p)) return `NAYA`;

  if (/\b(?:какая\s+модель|какая\s+модель\s+используется|what\s+model|which\s+model)\b/i.test(low)) {
    return `MODEL`;
  }

  if (/\b(скачать|download|install|установить|ссылка|где|как|загрузить|получить)\b.*\b(скачать|download|приложение|app|android|ios|windows|виндовс|платформа)\b/i.test(p) || /\b(скачать|download|install|установить|ссылка)\b/i.test(p)) {
    return `DOWNLOADS`;
  }

  if (/\b(ключ|создать\s+ключ|create\s+key|auth|авторизоваться|авторизация)\b/i.test(p)) {
    return `KEY`;
  }

  return null;
}

const tests = [
  'Привет',
  'кто такая сандра',
  'а сандра кто',
  'андрей вих кто',
  'Андрей Вихт кто',
  'who is viht',
  'кто такая ная',
  'ная кто',
  'как скачать для Windows',
  'скачать',
  'скачать приложение для андроид',
  'скачать viht',
  'где скачать',
  'скачать для android',
  'скачать для ios',
  'как создать ключ',
  'ключ как создать',
  'скачать для виндовс',
  'скачать приложение viht vpn',
  'кто Андрей Вихт',
  'кто такой Viht',
  'Кто Sandra',
  'Кто Naya Bay',
  'андрей',
  'сандра',
  'ная',
  'скачать apk',
  'скачать для телефона',
  'где найти загрузки',
  'как мне скачать приложение',
  'привет, кто такой вихт',
  'вихт кто',
  'сандра кто',
  'naya who is',
  'who is sandra',
  'who is andrey viht',
  'какая модель используется',
  'what model',
];

console.log('Running canned-response tests:');
for (const t of tests) {
  const res = cannedResponse(t);
  console.log(`${res ? '[CANNED:' + res + ']' : '[NO]     '}  -> ${t}`);
}
