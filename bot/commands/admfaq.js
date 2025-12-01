const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Admin commands with descriptions
const adminCommands = [
  { name: 'clearchat', emoji: '🗑️', ru: 'Очистить чат (удалить множество сообщений)', en: 'Clear chat (bulk delete messages)' },
  { name: 'setvpn', emoji: '🌐', ru: 'Установить статус VPN', en: 'Set VPN status' },
  { name: 'aiprivacy', emoji: '🔒', ru: 'Управление приватностью ИИ (опции: optin/optout/delete)', en: 'Manage AI privacy (optin/optout/delete)' },
  { name: 'mstop', emoji: '⏹️', ru: 'Принудительно остановить плеер и показать его занятость', en: 'Force stop music player and view status' },
  { name: 'admfaq', emoji: '👑', ru: 'Список администраторских команд (этот список)', en: 'Admin commands list (this list)' },
];

const ADMIN_ROLE_ID = '1436485697392607303';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admfaq')
    .setDescription('Список администраторских команд'),

  async execute(interaction) {
    // Check if user has admin role
    const member = interaction.member;
    const isAdmin = member && member.roles && member.roles.cache && member.roles.cache.has(ADMIN_ROLE_ID);

    if (!isAdmin) {
      await interaction.reply({
        content: 'У вас нет доступа к этой команде. Требуется администраторская роль.',
        ephemeral: true
      });
      return;
    }

    const lang = (interaction.client && interaction.client.userLangs && interaction.client.userLangs.get(interaction.user.id)) || 'ru';
    const isRu = lang === 'ru';

    const embed = new EmbedBuilder()
      .setTitle(isRu ? '👑 Администраторские команды' : '👑 Admin Commands')
      .setColor(0xff6b6b)
      .setDescription(isRu ? 'Команды только для администраторов сервера' : 'Commands available only for server administrators');

    for (const cmd of adminCommands) {
      const description = isRu ? cmd.ru : cmd.en;
      embed.addFields({
        name: `${cmd.emoji} /${cmd.name}`,
        value: description,
        inline: false
      });
    }

    embed.setFooter({ text: isRu ? 'Осторожно с этими командами!' : 'Use with caution!' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
