const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Define all commands for help
const userCommands = [
  { name: 'faq', emoji: '❓', ru: 'Список всех команд', en: 'List of all commands' },
  { name: 'profile', emoji: '👤', ru: 'Просмотр профиля и статистики', en: 'View profile and stats' },
  { name: 'help', emoji: '🆘', ru: 'Справка по боту', en: 'Bot help' },
  { name: 'info', emoji: 'ℹ️', ru: 'Информация о сервере', en: 'Server information' },
  { name: 'viht', emoji: '🔑', ru: 'О сервисе Viht', en: 'About Viht service' },
  { name: 'vpn', emoji: '🌐', ru: 'Информация о VPN', en: 'VPN information' },
  { name: 'vers', emoji: '📦', ru: 'Версия бота', en: 'Bot version' },
  { name: 'remind', emoji: '⏰', ru: 'Установить напоминание', en: 'Set reminder' },
  { name: 'music', emoji: '🎵', ru: 'Управление музыкой', en: 'Music control' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Справка по командам бота'),

  async execute(interaction) {
    const lang = (interaction.client && interaction.client.userLangs && interaction.client.userLangs.get(interaction.user.id)) || 'ru';
    const isRu = lang === 'ru';

    const embed = new EmbedBuilder()
      .setTitle(isRu ? '📚 Справка по командам' : '📚 Bot Help')
      .setColor(0x3498db)
      .setDescription(isRu ? 'Вот все доступные команды для вас' : 'Here are all available commands for you');

    for (const cmd of userCommands) {
      const description = isRu ? cmd.ru : cmd.en;
      embed.addFields({
        name: `${cmd.emoji} /${cmd.name}`,
        value: description,
        inline: false
      });
    }

    embed.setFooter({ text: isRu ? 'Используйте /admfaq для администраторских команд' : 'Use /admfaq for admin commands' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
