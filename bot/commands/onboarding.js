const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('onboarding')
    .setDescription('Настройки приветственных сообщений (DM)')
    .addStringOption(opt => opt.setName('action').setDescription('optin|optout|status').setRequired(true)),

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
    const prefs = db.get('prefs') || {};
    prefs.onboarding = prefs.onboarding || {};

    if (action === 'optout') {
      prefs.onboarding[userId] = false;
      await db.set('prefs', prefs);
      return await interaction.reply({ content: 'Отключено приветственное DM.', ephemeral: true });
    }
    if (action === 'optin') {
      prefs.onboarding[userId] = true;
      await db.set('prefs', prefs);
      return await interaction.reply({ content: 'Включено приветственное DM.', ephemeral: true });
    }
    // status
    const status = prefs.onboarding[userId] !== false;
    await interaction.reply({ content: status ? 'Приветственные DM включены.' : 'Приветственные DM отключены.', ephemeral: true });
  }
};
