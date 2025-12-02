const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../libs/db');
const chatHistory = require('./chatHistory');

function makeButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_register').setLabel('Зарегистрировать ИИ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ai_new').setLabel('Создать новую ветку').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ai_close').setLabel('Закрыть ветку').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ai_delete').setLabel('Удалить старую').setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

function summarizeForEmbed(userId, aiChats) {
  // Build a short description showing this user's chat id and status
  const rec = aiChats && aiChats[userId];
  if (!rec) return 'Нажмите кнопку, чтобы зарегистрировать персонального ИИ и создать приватный чат.';
  return `🔒 Ваша ветка: **${rec.chatId}**\nСтатус: **${rec.status || 'open'}**\nСоздано: ${new Date(rec.createdAt).toLocaleString()}`;
}

async function handleAiButton(interaction) {
  try {
    await db.ensureReady();
    const userId = String(interaction.user.id);
    const all = db.get('aiChats') || {};
    const id = interaction.customId;

    if (id === 'ai_register') {
      // If already has an open branch
      const existing = all[userId];
      if (existing && existing.status === 'open') {
        await interaction.reply({ content: `У вас уже есть ветка: ${existing.chatId}`, ephemeral: true });
        return;
      }

      if (existing && existing.status === 'closed') {
        existing.status = 'open';
        existing.reopenedAt = new Date().toISOString();
        await db.set('aiChats', all);
        // Edit original message to reflect
        try {
          const embed = (interaction.message.embeds && interaction.message.embeds[0]) ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle('🤖 Персональный ИИ');
          embed.setDescription(summarizeForEmbed(userId, all));
          await interaction.message.edit({ embeds: [embed], components: makeButtons() }).catch(() => null);
        } catch (e) {}
        await interaction.reply({ content: `Ваша ветка ${existing.chatId} восстановлена.`, ephemeral: true });
        return;
      }

      // Create a new chat id and record
      const chatId = `ai_${Date.now()}`;
      all[userId] = { chatId, status: 'open', createdAt: new Date().toISOString() };
      // Create a private thread for user's AI chat under the same channel where button was pressed
      try {
        const parent = interaction.message.channel;
        const threadName = `ai-${interaction.user.username}-${Date.now()}`;
        const thread = await parent.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread }).catch(() => null);
        if (thread) {
          try { await thread.members.add(interaction.user.id).catch(() => null); } catch (e) {}
          all[userId].threadId = thread.id;
          all[userId].threadChannel = parent.id;
        }
      } catch (e) {
        console.warn('Failed creating AI private thread', e && e.message ? e.message : e);
      }

      await db.set('aiChats', all);

      // Initialize chat history store for user+chatId (separate key)
      try { chatHistory.clearHistory(`${userId}:${chatId}`); } catch (e) {}

      // Edit original message to show the created chat id for this user and thread link
      try {
        const embed = (interaction.message.embeds && interaction.message.embeds[0]) ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle('🤖 Персональный ИИ');
        let desc = summarizeForEmbed(userId, all);
        if (all[userId].threadId) desc += `\nТред: <#${all[userId].threadId}>`;
        embed.setDescription(desc);
        await interaction.message.edit({ embeds: [embed], components: makeButtons() }).catch(() => null);
      } catch (e) {}

      await interaction.reply({ content: `✅ Зарегистрировано. Ваш AI Chat ID: ${chatId}${all[userId].threadId ? ` — тред создан: <#${all[userId].threadId}>` : ''}`, ephemeral: true });
      return;
    }

    if (id === 'ai_close') {
      const existing = all[userId];
      if (!existing || existing.status !== 'open') {
        await interaction.reply({ content: 'У вас нет открытой ветки для закрытия.', ephemeral: true });
        return;
      }
      existing.status = 'closed';
      existing.closedAt = new Date().toISOString();
      await db.set('aiChats', all);
      try {
        const embed = (interaction.message.embeds && interaction.message.embeds[0]) ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle('🤖 Персональный ИИ');
        embed.setDescription(summarizeForEmbed(userId, all));
        await interaction.message.edit({ embeds: [embed], components: makeButtons() }).catch(() => null);
      } catch (e) {}
      await interaction.reply({ content: `Ветка ${existing.chatId} закрыта.`, ephemeral: true });
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
      all[userId] = { chatId, status: 'open', createdAt: new Date().toISOString() };
      await db.set('aiChats', all);
      try { const embed = (interaction.message.embeds && interaction.message.embeds[0]) ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle('🤖 Персональный ИИ'); embed.setDescription(summarizeForEmbed(userId, all)); await interaction.message.edit({ embeds: [embed], components: makeButtons() }).catch(() => null); } catch (e) {}
      await interaction.reply({ content: `Создана новая ветка: ${chatId}`, ephemeral: true });
      return;
    }

    if (id === 'ai_delete') {
      const existing = all[userId];
      if (!existing) { await interaction.reply({ content: 'У вас нет ветки для удаления.', ephemeral: true }); return; }
      delete all[userId];
      await db.set('aiChats', all);
      try { const embed = (interaction.message.embeds && interaction.message.embeds[0]) ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle('🤖 Персональный ИИ'); embed.setDescription('Нажмите кнопку, чтобы зарегистрировать персонального ИИ и создать приватный чат.'); await interaction.message.edit({ embeds: [embed], components: makeButtons() }).catch(() => null); } catch (e) {}
      await interaction.reply({ content: `Ваша ветка удалена.`, ephemeral: true });
      return;
    }

    // Unknown ai action
    await interaction.reply({ content: 'Неизвестная операция AI.', ephemeral: true });
  } catch (e) {
    console.error('AI button handler error', e && e.message ? e.message : e);
    try { await interaction.reply({ content: 'Ошибка при обработке кнопки ИИ.', ephemeral: true }); } catch (ignore) {}
  }
}

module.exports = { handleAiButton };
