const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('📋 [АДМИН] Просмотреть историю действий')
    .addStringOption(opt => opt
      .setName('type')
      .setDescription('Тип действия для фильтрации')
      .addChoices(
        { name: '⚠️ Все варны', value: 'warns' },
        { name: '🔇 Все муты', value: 'mutes' },
        { name: '🚫 Все баны', value: 'bans' },
        { name: '📝 Все действия', value: 'all' }
      )
      .setRequired(false))
    .addUserOption(opt => opt.setName('user').setDescription('Фильтр по пользователю').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const type = interaction.options.getString('type') || 'all';
    const filterUser = interaction.options.getUser('user');

    const userViolations = db.get('userViolations') || {};
    const mutes = db.get('mutes') || {};
    const bans = db.get('bans') || {};

    let entries = [];

    // Собрать варны
    if (type === 'warns' || type === 'all') {
      for (const [userId, userViolationsList] of Object.entries(userViolations)) {
        if (filterUser && userId !== filterUser.id) continue;
        userViolationsList.forEach(v => {
          if (v.type !== 'warn') return; // только варны, не другие нарушения
          entries.push({
            type: 'Варн',
            user: userId,
            admin: v.adminId,
            reason: v.reason,
            timestamp: v.timestamp,
            color: '#FF6B6B'
          });
        });
      }
    }

    // Собрать муты
    if (type === 'mutes' || type === 'all') {
      for (const [userId, mute] of Object.entries(mutes)) {
        if (filterUser && userId !== filterUser.id) continue;
        entries.push({
          type: 'Мут',
          user: userId,
          admin: mute.adminId,
          reason: mute.reason,
          timestamp: mute.muteTime,
          color: '#808080'
        });
      }
    }

    // Собрать баны
    if (type === 'bans' || type === 'all') {
      for (const [userId, ban] of Object.entries(bans)) {
        if (filterUser && userId !== filterUser.id) continue;
        entries.push({
          type: 'Бан',
          user: userId,
          admin: ban.adminId,
          reason: ban.reason,
          timestamp: ban.timestamp,
          color: '#FF0000'
        });
      }
    }

    // Сортировать по дате (новые первыми)
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (entries.length === 0) {
      return await interaction.reply({ content: '📋 История пуста.', ephemeral: true });
    }

    // Разделить на страницы (10 записей на странице)
    const pageSize = 10;
    const pages = [];

    for (let i = 0; i < entries.length; i += pageSize) {
      const pageEntries = entries.slice(i, i + pageSize);
      const description = pageEntries
        .map(e => {
          const date = new Date(e.timestamp).toLocaleString();
          return `**${e.type}** | <@${e.user}> | Админ: <@${e.admin}>\n📝 ${e.reason}\n🕐 ${date}`;
        })
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setColor('#FFC107')
        .setTitle('📋 История административных действий')
        .setDescription(description)
        .setFooter({ text: `Страница ${Math.floor(i / pageSize) + 1}/${Math.ceil(entries.length / pageSize)} | Всего: ${entries.length}` })
        .setTimestamp();

      pages.push(embed);
    }

    // Отправить первую страницу
    await interaction.reply({ embeds: [pages[0]], ephemeral: true });
  }
};
