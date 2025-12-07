const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../libs/db');
const chatHistory = require('./chatHistory');

const CONTROL_ROLE_ID = '1436485697392607303';
function makeButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_register').setLabel('Зарегистрировать ИИ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ai_new').setLabel('Создать новую ветку').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ai_list').setLabel('Мои ветки').setStyle(ButtonStyle.Success)
  );
  return [row];
}

function summarizeForEmbed(userId, aiChats) {
  // Build a short description showing this user's chat id and status
  const rec = aiChats && aiChats[userId];
  if (!rec) return 'Нажмите кнопку, чтобы зарегистрировать персонального ИИ и создать приватный чат.';
  return `🔒 Ваша ветка: **${rec.chatId}**\nСтатус: **${rec.status || 'open'}**\nСоздано: ${new Date(rec.createdAt).toLocaleString()}`;
}

function createAiPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🤖 Персональный ИИ')
    .setColor(0x0055ff)
    .setDescription('Нажмите кнопку ниже, чтобы создать вашу приватную ветку ИИ. Каждая ветка приватна — видите только вы и пользователи с ролью доступа.')
    .setFooter({ text: 'Создаётся приватный тред для каждого пользователя' });
  return embed;
}

async function handleAiButton(interaction) {
  try {
    await db.ensureReady();
    const userId = String(interaction.user.id);
    const all = db.get('aiChats') || {};
    const id = interaction.customId;

    // helper to reply safely (followUp if already replied/deferred)
    async function replySafe(payload) {
      try {
        if (interaction.replied || interaction.deferred) return await interaction.followUp(payload).catch(() => null);
        return await interaction.reply(payload).catch(() => null);
      } catch (e) { return null; }
    }

    if (id === 'ai_register') {
      // If already has an open branch
      const existing = all[userId];
      if (existing && existing.status === 'open') {
          await replySafe({ content: `У вас уже есть ветка: ${existing.chatId}`, ephemeral: true });
        return;
      }

      if (existing && existing.status === 'closed') {
        existing.status = 'open';
        existing.reopenedAt = new Date().toISOString();
        await db.set('aiChats', all);
        // Inform the user privately (do not edit the shared control panel)
        await replySafe({ content: `Ваша ветка ${existing.chatId} восстановлена.`, ephemeral: true });
        return;
      }

      // Create a new chat id (we'll persist it only after successful thread creation)
      const chatId = `ai_${Date.now()}`;
      // Create a private thread for user's AI chat attached to the original message
      try {
        const threadName = `ai-${interaction.user.username}-${Date.now()}`;
        let thread = null;
        try {
          const channel = interaction.message.channel;
          if (channel && channel.threads && typeof channel.threads.create === 'function') {
            thread = await channel.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
          } else {
            // fallback to startThread if channel API not available
            thread = await interaction.message.startThread({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
          }
        } catch (errThread) {
          console.warn('creating private thread failed', errThread && errThread.message ? errThread.message : errThread);
          thread = null;
        }

        if (thread) {
          // persist the chat record now that thread exists
          all[userId] = { chatId, status: 'open', createdAt: new Date().toISOString() };
          try { await thread.members.add(interaction.user.id).catch(() => null); } catch (e) { /* ignore */ }
          all[userId].threadId = thread.id;
          all[userId].threadChannel = interaction.message.channel.id;
          // Restrict visibility: deny @everyone, allow only the creator user
          try {
            if (interaction.guild && typeof thread.permissionOverwrites === 'object') {
              try { await thread.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(() => null); } catch (e) {}
              try { await thread.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true }).catch(() => null); } catch (e) {}
            }
          } catch (e) {}
          // Send a welcome message inside thread so it appears active and the user sees it
          try {
            const welcome = `Привет <@${interaction.user.id}>! Это приватная ветка ИИ. Пишите здесь — бот будет отвечать в этой ветке.`;
            await thread.send({ content: welcome }).catch(() => null);
          } catch (e) { /* ignore */ }
        } else {
          console.warn('Thread creation failed for user', interaction.user.id);
          // do not persist a chat record if thread couldn't be created
          await replySafe({ content: 'Не удалось создать приватную ветку. У бота нет прав на создание приватных тредов в этом канале. Попросите администратора включить соответствующие права.', ephemeral: true });
          return;
        }
      } catch (e) {
        console.warn('Failed creating AI thread', e && e.message ? e.message : e);
      }

      await db.set('aiChats', all);

      // Initialize chat history store for user+chatId (separate key)
      try { chatHistory.clearHistory(`${userId}:${chatId}`); } catch (e) {}

      // Don't edit the shared control panel - reply ephemerally with the branch/thread info
      await replySafe({ content: `✅ Зарегистрировано. Ваш AI Chat ID: ${chatId}${all[userId].threadId ? ` — тред создан: <#${all[userId].threadId}>` : ''}`, ephemeral: true });
      return;
    }

    if (id === 'ai_list') {
      // Show list of user's chats with select menu
      const userChats = all[userId];
      if (!userChats) {
        await replySafe({ content: 'У вас нет ветки. Нажмите "Зарегистрировать ИИ" или "Создать новую ветку".', ephemeral: true });
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`ai_chat_select_${Date.now()}`)
        .setPlaceholder('Выберите ветку')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Ветка: ${userChats.chatId}`)
            .setValue('main')
            .setDescription(`Статус: ${userChats.status || 'open'}`)
        );

      const row = new ActionRowBuilder().addComponents(select);
      await replySafe({ content: 'Выберите ветку для управления:', components: [row], ephemeral: true });
      return;
    }

    if (id === 'ai_new') {
      const existing = all[userId];
      if (existing && existing.status === 'open') {
        // archive old
        existing.status = 'archived';
        existing.archivedAt = new Date().toISOString();
      }
      const chatId = `ai_${Date.now()}`;
      // create thread for new chat
      try {
        const threadName = `ai-${interaction.user.username}-${Date.now()}`;
        let thread = null;
        try {
          const channel = interaction.message.channel;
          if (channel && channel.threads && typeof channel.threads.create === 'function') {
            thread = await channel.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
          } else {
            thread = await interaction.message.startThread({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
          }
        } catch (err) {
          console.warn('creating private thread failed for ai_new', err && err.message ? err.message : err);
          thread = null;
        }
        if (!thread) {
          await replySafe({ content: 'Не удалось создать приватную ветку. У бота нет прав на создание приватных тредов в этом канале.', ephemeral: true });
          return;
        }
        // persist and add only the user
        all[userId] = { chatId, status: 'open', createdAt: new Date().toISOString(), threadId: thread.id, threadChannel: interaction.message.channel.id };
        try { await thread.members.add(interaction.user.id).catch(() => null); } catch (e) {}
        try { await thread.send({ content: `Привет <@${interaction.user.id}>! Это новая приватная ветка ИИ.` }).catch(() => null); } catch (e) {}
        await db.set('aiChats', all);
        try { chatHistory.clearHistory(`${userId}:${chatId}`); } catch (e) {}
        await replySafe({ content: `Создана новая ветка: ${chatId} — тред: <#${thread.id}>`, ephemeral: true });
        return;
      } catch (e) {
        console.warn('ai_new failed', e && e.message ? e.message : e);
        await replySafe({ content: 'Ошибка при создании новой ветки.', ephemeral: true });
        return;
      }
    }



    // Unknown ai action
    await replySafe({ content: 'Неизвестная операция AI.', ephemeral: true });
  } catch (e) {
    console.error('AI button handler error', e && e.message ? e.message : e);
    try { await interaction.reply({ content: 'Ошибка при обработке кнопки ИИ.', ephemeral: true }).catch(() => null); } catch (ignore) {}
  }
}

module.exports = { handleAiButton, createAiPanelEmbed, makeButtons };
