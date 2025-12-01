const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Работа с тикетами')
    .addSubcommand(s => s.setName('status').setDescription('Показать статус тикета').addStringOption(o => o.setName('id').setDescription('ID тикета').setRequired(false))),

  async execute(interaction) {
    // Check admin role
    const ADMIN_ROLE = '1436485697392607303';
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
    if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(ADMIN_ROLE)) {
      return await interaction.reply({ content: 'У вас нет доступа к этой команде. Требуется административная роль.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    await db.ensureReady();
    const tickets = db.get('tickets') || [];
    if (sub === 'status') {
      const id = interaction.options.getString('id');
      if (!id) {
        // show user's open tickets
        const userTickets = tickets.filter(t => t.creatorId === interaction.user.id);
        if (!userTickets || userTickets.length === 0) return await interaction.reply({ content: 'У вас нет тикетов.', ephemeral: true });
        const list = userTickets.map(t => `ID: ${t.id} — ${t.status}`).join('\n');
        return await interaction.reply({ content: `Ваши тикеты:\n${list}`, ephemeral: true });
      }
      const t = tickets.find(x => x.id === id);
      if (!t) return await interaction.reply({ content: 'Тикет не найден.', ephemeral: true });
      return await interaction.reply({ content: `Тикет ${t.id} — статус: ${t.status}` , ephemeral: true });
    }
    await interaction.reply({ content: 'Неизвестная подкоманда.', ephemeral: true });
  }
};
