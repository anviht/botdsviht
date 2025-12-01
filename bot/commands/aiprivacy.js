const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');
const chatHistory = require('../ai/chatHistory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aiprivacy')
    .setDescription('🔒 Управление приватностью ИИ: история, удаление (только администраторы)')
    .addStringOption(opt => opt.setName('action').setDescription('optin|optout|delete').setRequired(true)),

  async execute(interaction) {
    // Check admin role
    const config = require('../config');
    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
    if (!member || !member.roles || !member.roles.cache || !isAdmin) {
      return await interaction.reply({ content: 'У вас нет доступа к этой команде. Требуется административная роль.', ephemeral: true });
    }

    const action = interaction.options.getString('action');
    const userId = interaction.user.id;
    await db.ensureReady();
    const aiPrefs = db.get('aiPrefs') || {};

    if (action === 'optout' || action === 'optin') {
      const hasRole = isAdmin;
      if (!hasRole) {
        return await interaction.reply({ content: 'У вас нет прав для включения/отключения сохранения истории. Обратитесь к администратору.', ephemeral: true });
      }
      if (action === 'optout') {
        aiPrefs[userId] = { optOut: true };
        await db.set('aiPrefs', aiPrefs);
        return await interaction.reply({ content: 'Вы отключили сохранение истории общения с ИИ.', ephemeral: true });
      }
      // optin
      aiPrefs[userId] = { optOut: false };
      await db.set('aiPrefs', aiPrefs);
      return await interaction.reply({ content: 'Вы включили сохранение истории общения с ИИ.', ephemeral: true });
    }
    if (action === 'delete') {
      chatHistory.clearHistory(userId);
      // Also remove from aiPrefs
      if (aiPrefs[userId]) delete aiPrefs[userId];
      await db.set('aiPrefs', aiPrefs);
      return await interaction.reply({ content: 'Ваша история с ИИ удалена.', ephemeral: true });
    }

    await interaction.reply({ content: 'Неизвестная команда.', ephemeral: true });
  }
};
