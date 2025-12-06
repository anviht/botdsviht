const { EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

const badwordsList = require('./badwords.json');
const BADWORD_LOG_CHANNEL = '1446796960697679953';
const MODERATION_LOG_CHANNEL = '1446798710511243354';
const MUTE_ROLE_ID = '1445152678706679939'; // preset mute role id used across the bot

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

    // Получаем мьют роль по предустановленному ID или по имени, либо создаём
    let mutedRole = guild.roles.cache.get(MUTE_ROLE_ID) || guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
    if (!mutedRole) {
      try {
        mutedRole = await guild.roles.create({ 
          name: 'Muted', 
          color: '#808080',
          reason: 'Auto-created muted role for badword filter'
        });
        // apply permission overwrites on all channels for the new role
      } catch (e) {
        console.warn('Could not create Muted role:', e.message);
        return;
      }
    }

    // Ensure the muted role has channel permission overwrites set (deny send/speak/connect/add reactions)
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
          // ignore per-channel errors
        }
      }
    } catch (e) {
      // ignore fetching channel errors
    }

    // Применяем мьют: используем конфигируемое время из badwords.json
    const member = message.member;
    const unit = (badwordsList.muteUnit || 'minute');
    const timeVal = Number(badwordsList.muteTime) || 1;
    const muteMs = unit === 'minute' ? timeVal * 60000 : (unit === 'second' ? timeVal * 1000 : timeVal * 60000);

    try {
      await member.roles.add(mutedRole, `Автоматический мьют за матерные слова: ${foundBadwords.slice(0, 3).join(', ')}${foundBadwords.length > 3 ? '...' : ''}`);
    } catch (e) {
      console.error('Failed to mute member:', e.message);
      return;
    }

    // Логируем в канал BADWORD_LOG_CHANNEL и в канал модерации
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
          { name: 'Полный текст', value: content.length > 1000 ? content.substring(0, 1000) + '...' : content, inline: false },
          { name: 'Наказание', value: `🔇 Мьют на ${badwordsList.muteTime} ${badwordsList.muteUnit === 'minute' ? 'минуту' : 'минут'}`, inline: false }
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
            { name: 'Длительность', value: `${badwordsList.muteTime} ${badwordsList.muteUnit}`, inline: true },
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

    // (Снятие мьюта планируется и обрабатывается далее через запись в DB и локальный таймер)

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

    // Сохраняем мьют в глобальную таблицу mutes, чтобы система могла отменить мьют даже после рестарта
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
        removedRoles: []
      };
      await db.set('mutes', mutes);

      // Schedule unmute locally
      global.muteTimers = global.muteTimers || {};
      if (global.muteTimers[targetId]) clearTimeout(global.muteTimers[targetId]);
      global.muteTimers[targetId] = setTimeout(async () => {
        try {
          const stored = db.get('mutes') || {};
          const entry = stored[targetId];
          if (!entry) return;
          const updatedMember = await guild.members.fetch(targetId).catch(() => null);
          if (!updatedMember) return;
          // Remove mute role
          if (updatedMember.roles.cache.has(mutedRole.id)) {
            try { await updatedMember.roles.remove(mutedRole.id, 'Автоматическое снятие мьюта (время истекло)'); } catch (e) { console.warn('Failed to remove mute role during auto-unmute:', e.message); }
          }
          // Remove entry from DB
          delete stored[targetId];
          await db.set('mutes', stored);

          // Notify moderation channel about unmute
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

          // Try to DM user about unmute
          try { await (await client.users.fetch(targetId)).send({ embeds: [new EmbedBuilder().setTitle('🔊 Мут снят').setDescription('Вас размучили на сервере').setTimestamp()] }).catch(()=>null); } catch(e){}
        } catch (e) {
          console.error('Auto-unmute timer error:', e.message);
        }
      }, muteMs);
    } catch (e) {
      console.warn('Failed to write auto-mute to DB:', e.message);
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
