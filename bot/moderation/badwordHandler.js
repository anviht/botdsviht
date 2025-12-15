const { EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

const badwordsList = require('./badwords.json');
const BADWORD_LOG_CHANNEL = '1446796960697679953';
const MODERATION_LOG_CHANNEL = '1446798710511243354';
const MUTE_ROLE_ID = '1445152678706679939'; // preset mute role id used across the bot

/**
 * Карта транслитерации русских букв на английские
 */
const RUSSIAN_TO_ENGLISH = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
  'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

/**
 * Карта транслитерации английских букв на русские (где имеют смысл)
 */
const ENGLISH_TO_RUSSIAN = {
  'a': 'а', 'b': 'б', 'c': 'с', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г',
  'h': 'х', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
  'o': 'о', 'p': 'р', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
  'v': 'в', 'w': 'в', 'x': 'х', 'y': 'у', 'z': 'з'
};

/**
 * Нормализирует текст удаляя спецсимволы (но НЕ пробелы, они нужны для разделения слов)
 */
function cleanText(text) {
  return text
    .toLowerCase()
    // Заменяем распространенные обфускации цифр на буквы
    // Это основано на визуальном сходстве (0->о, 1->и, и т.д.)
    .replace(/0/g, 'о')      // 0 похожа на О
    .replace(/1/g, 'и')      // 1 похожа на И или Л
    .replace(/2/g, 'з')      // 2 похожа на З
    .replace(/3/g, 'з')      // 3 похожа на З
    .replace(/4/g, 'а')      // 4 похожа на А
    .replace(/5/g, 'с')      // 5 похожа на С
    .replace(/6/g, 'б')      // 6 похожа на Б
    .replace(/7/g, 'т')      // 7 похожа на Т
    .replace(/8/g, 'в')      // 8 похожа на В
    .replace(/9/g, 'б')      // 9 похожа на Б
    // Удаляем все остальные спецсимволы
    .replace(/[^а-яёa-z\s]/g, '') // Оставляем только буквы и пробелы
    .replace(/\s+/g, ' ')   // Объединяем множественные пробелы в один
    .trim();                 // Удаляем начальные и конечные пробелы
}

/**
 * Конвертирует текст из русского в английский
 */
function russianToEnglish(text) {
  return text.split('').map(ch => RUSSIAN_TO_ENGLISH[ch] || ch).join('');
}

/**
 * Конвертирует текст из английского в русский
 */
function englishToRussian(text) {
  return text.split('').map(ch => ENGLISH_TO_RUSSIAN[ch] || ch).join('');
}

/**
 * Генерирует все возможные варианты текста (с разными раскладками)
 */
function generateVariants(text) {
  const cleaned = cleanText(text);
  const variants = new Set([cleaned]);
  
  // Добавляем русский вариант
  variants.add(cleanText(englishToRussian(cleaned)));
  
  // Добавляем английский вариант
  variants.add(cleanText(russianToEnglish(cleaned)));
  
  return Array.from(variants);
}

/**
 * Проверяет текст на матерные слова с поддержкой разных раскладок
 */
function normalizeText(text) {
  const variants = generateVariants(text);
  return variants;
}

/**
 * Глобальная очередь для обработки матов (избегаем перегрузки при рейде)
 */
global.badwordQueue = global.badwordQueue || [];
global.badwordProcessing = global.badwordProcessing || false;

/**
 * Обрабатывает очередь матов по одному
 */
async function processBadwordQueue(client) {
  if (!global.badwordQueue) global.badwordQueue = [];
  if (global.badwordProcessing || global.badwordQueue.length === 0) return;
  
  console.log(`[BADWORD-QUEUE] Начало обработки очереди, размер: ${global.badwordQueue.length}`);
  global.badwordProcessing = true;
  try {
    while (global.badwordQueue.length > 0) {
      const item = global.badwordQueue.shift();
      if (item) {
        try {
          await handleBadwordMute(item.message, item.foundBadwords, client);
          // Задержка между обработками, чтобы не напрягать API
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error('Error processing queued badword:', e.message);
        }
      }
    }
  } finally {
    global.badwordProcessing = false;
  }
}

/**
 * Определяет время мута на основе количества нарушений
 */
function getProgressiveMuteDuration(violationCount) {
  const durations = [1, 5, 15, 30, 60]; // минуты
  // После 5 нарушений - 1 час максимум
  return durations[Math.min(violationCount - 1, durations.length - 1)] || 60;
}

/**
 * Обработка одного нарушения мата
 */
async function handleBadwordMute(message, foundBadwords, client) {
  console.log(`[BADWORD-MUTE] Обработка: ${message.author.tag} | маты: ${foundBadwords.join(', ')}`);
  const guild = message.guild;
  if (!guild) {
    console.log('[BADWORD-MUTE] Нет гильдии!');
    return;
  }

  const member = message.member;
  if (!member || !member.roles) {
    console.log('[BADWORD-MUTE] Нет member или roles!');
    return;
  }

  const userId = message.author.id;

  // Проверяем иерархию ролей - не мутим людей выше по иерархии
  const botMember = await guild.members.fetch(client.user.id).catch(() => null);
  if (!botMember) return;

  // Если роль пользователя выше или равна роли бота - не мутим
  if (member.roles.highest.position >= botMember.roles.highest.position) {
    console.log(`[Badword] Skipping mute for ${member.user.tag} - higher or equal role hierarchy`);
    return;
  }

  // Track badword-specific violations separately from manual warnings
  // Используем отдельный ключ в БД: 'badwordViolations'
  const badwordViolations = db.get('badwordViolations') || {};
  let badwordList = badwordViolations[userId] || [];

  // Подсчитываем активные автоматические нарушения ДО добавления нового (последние 30 дней)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeBadwordViolations = badwordList.filter(v => new Date(v.timestamp).getTime() > thirtyDaysAgo);
  const currentViolationCount = activeBadwordViolations.length; // Сколько уже есть автоматических нарушений

  // Добавляем НОВОЕ автоматическое нарушение (за мат)
  const newViolation = {
    type: 'badword',
    reason: foundBadwords.slice(0, 3).join(', '),
    timestamp: new Date().toISOString(),
    severity: currentViolationCount + 1 // Номер этого автоматического нарушения
  };
  badwordList.push(newViolation);
  badwordViolations[userId] = badwordList;
  await db.set('badwordViolations', badwordViolations);

  // Определяем время мута на основе НОВОГО числа автоматических нарушений
  const nextViolationCount = currentViolationCount + 1; // После добавления нового
  // Для автоматических матов применяем прогрессивную шкалу: 1,5,15,30,60 минут
  let muteMinutes = getProgressiveMuteDuration(nextViolationCount);
  // ВАЖНО: не переводим автоматические нарушения в 24-часовой мут — это поведение относится к ручным варнам


  const muteMs = muteMinutes * 60000;

  // Получаем мьют роль
  let mutedRole = guild.roles.cache.get(MUTE_ROLE_ID) || guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (!mutedRole) {
    try {
      mutedRole = await guild.roles.create({ 
        name: 'Muted', 
        color: '#808080',
        reason: 'Auto-created muted role for badword filter'
      });
    } catch (e) {
      console.warn('Could not create Muted role:', e.message);
      return;
    }
  }

  // Устанавливаем переопределения прав для Muted
  try {
    const channels = await guild.channels.fetch();
    for (const [, channel] of channels) {
      try {
        if (channel.isTextBased && channel.isTextBased()) {
          await channel.permissionOverwrites.edit(mutedRole, {
            SendMessages: false,
            AddReactions: false,
            SendMessagesInThreads: false
          }).catch(() => null);
        }
        if (channel.isVoiceBased && channel.isVoiceBased()) {
          await channel.permissionOverwrites.edit(mutedRole, {
            Speak: false,
            Connect: false
          }).catch(() => null);
        }
      } catch (e) {
        // игнорируем ошибки на отдельных каналах
      }
    }
  } catch (e) {
    // игнорируем ошибки получения каналов
  }

  let currentRoles = [];

  try {
    // Сохраняем текущие роли пользователя
    currentRoles = member.roles.cache.filter(r => r.id !== member.guild.id && r.id !== (mutedRole.id)).map(r => r.id);
    console.log(`[BADWORD-MUTE] Снимаем роли: ${currentRoles.length} штук`);
    if (currentRoles.length > 0) {
      try {
        await member.roles.remove(currentRoles, 'Снятие ролей для автоматического мута').catch(() => null);
        console.log(`[BADWORD-MUTE] ✓ Роли сняты`);
      } catch (e) {
        console.log(`[BADWORD-MUTE] Ошибка снятия ролей: ${e.message}`);
      }
    }
    
    // Отключаем из голоса
    try { if (member.voice && member.voice.channel) await member.voice.setChannel(null).catch(()=>null); } catch(e) {}

    // Выдаём роль Muted
    await member.roles.add(mutedRole, `Автоматический мьют за матерные слова: ${foundBadwords.slice(0, 3).join(', ')}${foundBadwords.length > 3 ? '...' : ''}`);
    console.log(`[BADWORD-MUTE] ✓ Добавлена роль Muted (${muteMinutes} минут)`);
  } catch (e) {
    console.error('[BADWORD-MUTE] Ошибка при мутировании:', e.message);
    return;
  }

  // Логируем в каналы
  try {
    const embed = new EmbedBuilder()
      .setTitle('🚫 Обнаружены матерные слова')
      .setColor(0xFF6B6B)
      .setDescription(`Пользователь <@${message.author.id}> использовал матерные слова`)
      .addFields(
        { name: 'Пользователь', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
        { name: 'Найдено слов', value: `${foundBadwords.length} шт.`, inline: true },
        { name: 'Примеры', value: foundBadwords.slice(0, 5).join(', ') || 'N/A', inline: false },
        { name: 'Полный текст', value: message.content.length > 1000 ? message.content.substring(0, 1000) + '...' : message.content, inline: false },
        { name: 'Наказание', value: `🔇 Авто-мьют на ${muteMinutes} минут (авто-нарушение ${nextViolationCount})`, inline: false }
      )
      .setTimestamp();

    const badChannel = await client.channels.fetch(BADWORD_LOG_CHANNEL).catch(() => null);
    if (badChannel && badChannel.isTextBased && badChannel.isTextBased()) await badChannel.send({ embeds: [embed] }).catch(() => null);

    const modChannel = await client.channels.fetch(MODERATION_LOG_CHANNEL).catch(() => null);
    if (modChannel && modChannel.isTextBased && modChannel.isTextBased()) {
      const modEmbed = new EmbedBuilder()
        .setTitle('🔇 Авто-мут (автоматический)')
        .setColor(0xFF8A65)
        .setDescription(`<@${message.author.id}> получил(а) роль Muted`) 
        .addFields(
          { name: 'Пользователь', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
          { name: 'Длительность', value: `${muteMinutes} минут (авто-нарушение ${nextViolationCount})`, inline: true },
          { name: 'Причина', value: `Использование запрещённой лексики: ${foundBadwords.slice(0,3).join(', ')}${foundBadwords.length>3?'...':''}`, inline: false },
          { name: 'Канал', value: `<#${message.channelId}>`, inline: true }
        )
        .setTimestamp();
      await modChannel.send({ embeds: [modEmbed] }).catch(() => null);
    }
  } catch (e) {
    console.error('Failed to log badword message:', e.message);
  }

  // Удаляем сообщение
  try {
    await message.delete().catch(() => null);
  } catch (e) {
    console.warn('Failed to delete message with badwords:', e.message);
  }

  // DM пользователю
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Нарушение правил сервера')
      .setDescription(`Ваше сообщение было удалено за использование запрещённого контента`)
      .addFields(
        { name: 'Сервер', value: guild.name, inline: false },
        { name: 'Наказание', value: `🔇 Мьют на ${muteMinutes} минут (варна ${nextViolationCount}/3)`, inline: false },
        { name: 'Примечание', value: 'Попытки обхода фильтра также считаются нарушением', inline: false }
      )
      .setColor('#FF6B6B')
      .setTimestamp();

    await message.author.send({ embeds: [dmEmbed] }).catch(() => null);
  } catch (e) {
    console.warn('Failed to send DM to user:', e.message);
  }

  // Логируем в БД
  try {
    const badwordLogs = db.get('badwordLogs') || [];
    badwordLogs.push({
      userId: message.author.id,
      username: message.author.tag,
      guildId: guild.id,
      channelId: message.channelId,
      channelName: message.channel?.name || 'unknown',
      content: message.content,
      badwords: foundBadwords,
      count: foundBadwords.length,
      timestamp: new Date().toISOString(),
      action: 'muted'
    });

    if (badwordLogs.length > 10000) {
      badwordLogs.splice(0, badwordLogs.length - 10000);
    }

    await db.set('badwordLogs', badwordLogs);
  } catch (e) {
    console.warn('Failed to save badword log to DB:', e.message);
  }

  // Сохраняем мьют в DB
  try {
    const mutes = db.get('mutes') || {};
    const targetId = message.author.id;
    const unmuteAt = new Date(Date.now() + muteMs).toISOString();
    mutes[targetId] = {
      guildId: guild.id,
      adminId: 'automod',
      reason: 'Автоматический мьют за мат',
      muteTime: new Date().toISOString(),
      unmuteTime: unmuteAt,
      removedRoles: (member && member.roles && member.roles.cache) ? currentRoles : []
    };
    await db.set('mutes', mutes);

    // Планируем автоснятие мьюта
    global.muteTimers = global.muteTimers || {};
    if (global.muteTimers[targetId]) clearTimeout(global.muteTimers[targetId]);
    global.muteTimers[targetId] = setTimeout(async () => {
      try {
        const stored = db.get('mutes') || {};
        const entry = stored[targetId];
        if (!entry) return;
        const updatedMember = await guild.members.fetch(targetId).catch(() => null);
        if (!updatedMember) return;
        
        if (updatedMember.roles.cache.has(mutedRole.id)) {
          try { await updatedMember.roles.remove(mutedRole.id, 'Автоматическое снятие мьюта (время истекло)'); } catch (e) { console.warn('Failed to remove mute role during auto-unmute:', e.message); }
        }
        
        if (entry.removedRoles && entry.removedRoles.length > 0) {
          const toRestore = entry.removedRoles.filter(id => guild.roles.cache.has(id));
          if (toRestore.length > 0) {
            try { await updatedMember.roles.add(toRestore); } catch (e) { console.warn('Failed to restore roles after auto-unmute:', e.message); }
          }
        }
        
        delete stored[targetId];
        await db.set('mutes', stored);

        // Уведомляем модерацию
        try {
          const modChannel = await client.channels.fetch(MODERATION_LOG_CHANNEL).catch(() => null);
          if (modChannel && modChannel.isTextBased && modChannel.isTextBased()) {
            const emb = new EmbedBuilder()
              .setTitle('🔊 Мут снят (автоматически)')
              .setColor(0x2ECC71)
              .setDescription(`<@${targetId}> — срок мута истёк`) 
              .addFields({ name: 'Сервер', value: guild.name, inline: true })
              .setTimestamp();
            await modChannel.send({ embeds: [emb] }).catch(() => null);
          }
        } catch (e) {}

        // DM пользователю
        try { await (await client.users.fetch(targetId)).send({ embeds: [new EmbedBuilder().setTitle('🔊 Мут снят').setDescription('Вас размучили на сервере').setTimestamp()] }).catch(()=>null); } catch(e){}
      } catch (e) {
        console.error('Auto-unmute timer error:', e.message);
      }
    }, muteMs);
  } catch (e) {
    console.warn('Failed to write auto-mute to DB:', e.message);
  }
}

/**
 * Проверяет сообщение на матерные слова с обходом фильтров
 * @param {Message} message - Discord сообщение
 * @param {Client} client - Discord клиент
 */
async function checkMessage(message, client) {
  try {
    if (message.author?.bot) return;
    if (!message.content || message.content.length === 0) return;

    // Пропускаем сообщения от администраторов и модераторов
    if (message.member?.permissions.has('Administrator') || message.member?.permissions.has('ModerateMembers')) {
      return;
    }

    const content = message.content;
    console.log(`[BADWORD-CHECK] Проверка сообщения: "${content.slice(0, 50)}"`);
    const foundBadwords = [];
    
    // Удаляем @mentions и #hashtags перед проверкой (это может содержать символы, которые ошибочно срабатывают)
    const contentWithoutMentions = content
      .replace(/<@!?\d+>/g, '') // Discord mentions типа <@123456789>
      .replace(/@\S+/g, '')     // Обычные mentions типа @username
      .replace(/#\S+/g, '')     // Hashtags типа #channel
      .trim();
    
    if (contentWithoutMentions.length === 0) return; // Если только mentions/hashtags - выход
    
    // Нормализируем весь текст сообщения сразу
    const normalizedContent = cleanText(contentWithoutMentions);
    const transliteratedContent = englishToRussian(normalizedContent);
    const contentWords = normalizedContent.split(/\s+/).filter(w => w.length > 0);
    const transliteratedWords = transliteratedContent.split(/\s+/).filter(w => w.length > 0);
    
    // Проверяем каждое матерное слово из словаря
    for (const badword of badwordsList.badwords) {
      const cleanedBadword = cleanText(badword);
      
      if (cleanedBadword.length === 0) continue; // Пропускаем пустые слова
      
      // Проверяем каждое слово в сообщении (как нормализованное, так и транслитерированное)
      for (let i = 0; i < contentWords.length; i++) {
        const word = contentWords[i];
        const transliteratedWord = transliteratedWords[i];
        
        if (word.length === 0) continue;
        
        // 1. Прямое совпадение (слово === матерное слово)
        if (word === cleanedBadword || transliteratedWord === cleanedBadword) {
          if (!foundBadwords.includes(badword)) {
            foundBadwords.push(badword);
            console.log(`[BADWORD] ✓ EXACT MATCH: "${badword}" in word "${word}"`);
          }
          break;
        }
        
        // 2. Слово содержит матерное слово (для слов без пробелов)
        // НО: для очень коротких badwords (< 3 букв), требуем только exact match, чтобы избежать false positives
        if (cleanedBadword.length >= 3) {
          if (word.includes(cleanedBadword) || transliteratedWord.includes(cleanedBadword)) {
            if (!foundBadwords.includes(badword)) {
              foundBadwords.push(badword);
              console.log(`[BADWORD] ✓ CONTAINS: "${badword}" in word "${word}"`);
            }
            break;
          }
        }
        
        // 3. Матерное слово содержит слово (для частичных совпадений)
        // НО: только если badword длинный И слово достаточно длинное (минимум 3 буквы)
        if ((cleanedBadword.includes(word) || cleanedBadword.includes(transliteratedWord)) && word.length >= 4 && cleanedBadword.length >= 5) {
          if (!foundBadwords.includes(badword)) {
            foundBadwords.push(badword);
            console.log(`[BADWORD] ✓ PARTIAL: word "${word}" is part of badword "${badword}"`);
          }
          break;
        }
      }
      
      // Также проверяем в целом тексте без разделения на слова
      // Это нужно для текстов без пробелов типа "Вотэтонихуясебе"
      // НО: для коротких badwords требуем их длину >= 3, чтобы избежать false positives
      if (cleanedBadword.length >= 3) {
        if ((normalizedContent.includes(cleanedBadword) || transliteratedContent.includes(cleanedBadword)) && !foundBadwords.includes(badword)) {
          foundBadwords.push(badword);
          console.log(`[BADWORD] ✓ IN TEXT: "${badword}" found in normalized content`);
        }
      }
    }

    if (foundBadwords.length === 0) return;

    console.log(`[BADWORD] 🚨 НАЙДЕНЫ МАТЫ! Количество: ${foundBadwords.length}, слова: ${foundBadwords.slice(0, 3).join(', ')}`);

    // Инициализируем очередь если её нет
    if (!global.badwordQueue) global.badwordQueue = [];
    
    // Добавляем в очередь вместо параллельной обработки
    global.badwordQueue.push({ message, foundBadwords });
    console.log(`[BADWORD] Очередь размер: ${global.badwordQueue.length}`);
    
    // Начинаем обработку очереди
    processBadwordQueue(client);
  } catch (e) {
    console.error('badwordHandler error:', e.message);
  }
}

/**
 * Получить статистику матерных слов
 */
function getBadwordStats(userId) {
  try {
    const badwordLogs = db.get('badwordLogs') || [];
    const userLogs = badwordLogs.filter(log => log.userId === userId);
    return {
      total: userLogs.length,
      lastViolation: userLogs.length > 0 ? userLogs[userLogs.length - 1].timestamp : null,
      logs: userLogs.slice(-10) // последние 10 нарушений
    };
  } catch (e) {
    console.warn('Failed to get badword stats:', e.message);
    return { total: 0, lastViolation: null, logs: [] };
  }
}

module.exports = { checkMessage, normalizeText, getBadwordStats };
