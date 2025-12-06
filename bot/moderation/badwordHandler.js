const { EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

const badwordsList = require('./badwords.json');
const BADWORD_LOG_CHANNEL = '1446796960697679953';

/**
 * Нормализирует текст для проверки:
 * - Удаляет спецсимволы/пробелы между буквами
 * - Заменяет цифры похожие на буквы (0→о, 1→и, 3→з, 5→с, 7→т, 8→в)
 * - Переводит в нижний регистр
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/0/g, 'о').replace(/1/g, 'и').replace(/3/g, 'з').replace(/4/g, 'а')
    .replace(/5/g, 'с').replace(/7/g, 'т').replace(/8/g, 'в').replace(/9/g, 'б')
    .replace(/[._\-*~^&@!№%$#\"'()[\]{}<>|\\:/?,;+=`~]/g, '') // спецсимволы
    .replace(/\s+/g, ''); // пробелы
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

    const content = message.content;
    const normalizedContent = normalizeText(content);
    
    // Проверяем каждое матерное слово
    let foundBadwords = [];
    
    for (const badword of badwordsList.badwords) {
      const normalizedBadword = normalizeText(badword);
      
      // Проверяем есть ли слово в нормализованном тексте как подстрока
      if (normalizedContent.includes(normalizedBadword)) {
        foundBadwords.push(badword);
      }
    }

    if (foundBadwords.length === 0) return;

    const guild = message.guild;
    if (!guild) return;

    // Получаем мьют роль или создаем
    let mutedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
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

    // Применяем мьют на 1 минуту
    const member = message.member;
    const muteTime = 60000; // 1 минута в миллисекундах

    try {
      await member.roles.add(mutedRole, `Автоматический мьют за матерные слова: ${foundBadwords.slice(0, 3).join(', ')}${foundBadwords.length > 3 ? '...' : ''}`);
    } catch (e) {
      console.error('Failed to mute member:', e.message);
      return;
    }

    // Логируем в канал
    try {
      const logChannel = await client.channels.fetch(BADWORD_LOG_CHANNEL).catch(() => null);
      if (logChannel && logChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🚫 Обнаружены матерные слова')
          .setColor(0xFF6B6B)
          .setDescription(`Пользователь <@${message.author.id}> использовал матерные слова`)
          .addFields(
            { name: 'Пользователь', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
            { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
            { name: 'Найдено слов', value: `${foundBadwords.length} шт.`, inline: true },
            { name: 'Примеры', value: foundBadwords.slice(0, 5).join(', ') || 'N/A', inline: false },
            { name: 'Полный текст', value: content.length > 1000 ? content.substring(0, 1000) + '...' : content, inline: false },
            { name: 'Наказание', value: `🔇 Мьют на ${badwordsList.muteTime} ${badwordsList.muteUnit === 'minute' ? 'минуту' : 'минут'}`, inline: false }
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] }).catch(() => null);
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

    // Отправляем сообщение пользователю в DM
    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Нарушение правил сервера')
        .setDescription(`Ваше сообщение было удалено за использование запрещённого контента`)
        .addFields(
          { name: 'Сервер', value: guild.name, inline: false },
          { name: 'Наказание', value: `🔇 Мьют на ${badwordsList.muteTime} ${badwordsList.muteUnit === 'minute' ? 'минуту' : 'минут'}`, inline: false },
          { name: 'Примечание', value: 'Попытки обхода фильтра (пробелы, точки, цифры) также считаются нарушением', inline: false }
        )
        .setColor('#FF6B6B')
        .setTimestamp();

      await message.author.send({ embeds: [dmEmbed] }).catch(() => null);
    } catch (e) {
      console.warn('Failed to send DM to user:', e.message);
    }

    // Запланировать снятие мьюта через 1 минуту
    setTimeout(async () => {
      try {
        const updatedMember = await guild.members.fetch(message.author.id).catch(() => null);
        if (updatedMember && mutedRole) {
          await updatedMember.roles.remove(mutedRole, 'Автоматическое снятие мьюта (1 минута истекла)').catch(() => null);
        }
      } catch (e) {
        console.error('Failed to unmute member:', e.message);
      }
    }, muteTime);

    // Сохраняем в логи БД
    try {
      const badwordLogs = db.get('badwordLogs') || [];
      badwordLogs.push({
        userId: message.author.id,
        username: message.author.tag,
        guildId: guild.id,
        channelId: message.channelId,
        channelName: message.channel?.name || 'unknown',
        content: content,
        badwords: foundBadwords,
        count: foundBadwords.length,
        timestamp: new Date().toISOString(),
        action: 'muted'
      });

      // Сохраняем только последние 10000 логов
      if (badwordLogs.length > 10000) {
        badwordLogs.splice(0, badwordLogs.length - 10000);
      }

      await db.set('badwordLogs', badwordLogs);
    } catch (e) {
      console.warn('Failed to save badword log to DB:', e.message);
    }
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
