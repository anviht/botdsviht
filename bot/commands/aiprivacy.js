const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');
const chatHistory = require('../ai/chatHistory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aiprivacy')
    .setDescription('Настройки приватности для AI (история)')
    .addStringOption(opt => opt.setName('action').setDescription('optin|optout|delete').setRequired(true)),

  async execute(interaction) {
    // Check admin role
    const ADMIN_ROLE = '1436485697392607303';
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
    if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(ADMIN_ROLE)) {
      return await interaction.reply({ content: 'У вас нет доступа к этой команде. Требуется административная роль.', ephemeral: true });
    }

    const action = interaction.options.getString('action');
    const userId = interaction.user.id;
    await db.ensureReady();
    const aiPrefs = db.get('aiPrefs') || {};

    // Only users with admin role may opt users in/out of AI history
    const ADMIN_ROLE = '1436485697392607303';
    if (action === 'optout' || action === 'optin') {
      const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
      const hasRole = member && member.roles && member.roles.cache && member.roles.cache.has(ADMIN_ROLE);
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
