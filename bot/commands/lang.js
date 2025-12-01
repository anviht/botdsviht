const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lang')
    .setDescription('Выбрать язык для бота')
    .addStringOption(o => o.setName('locale').setDescription('ru|en').setRequired(true)),

  async execute(interaction) {
    // Check admin role
    const ADMIN_ROLE = '1436485697392607303';
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
    if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(ADMIN_ROLE)) {
      return await interaction.reply({ content: 'У вас нет доступа к этой команде. Требуется административная роль.', ephemeral: true });
    }

    const locale = interaction.options.getString('locale') === 'en' ? 'en' : 'ru';
    await db.ensureReady();
    const userLangs = db.get('userLangs') || {};
    userLangs[interaction.user.id] = locale;
    await db.set('userLangs', userLangs);
    // Also keep on client for quick access
    if (interaction.client) {
      interaction.client.userLangs = interaction.client.userLangs || new Map();
      interaction.client.userLangs.set(interaction.user.id, locale);
    }
    await interaction.reply({ content: locale === 'en' ? 'Language set to English.' : 'Язык установлен: Русский.', ephemeral: true });
  }
};
