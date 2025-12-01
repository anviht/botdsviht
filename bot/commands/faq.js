const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Define all regular user commands with their descriptions
const userCommands = [
  { name: 'faq', emoji: '❓', ru: 'Список всех команд', en: 'List of all commands' },
  { name: 'profile', emoji: '👤', ru: 'Просмотр профиля и статистики', en: 'View profile and stats' },
  { name: 'ticket', emoji: '🎫', ru: 'Посмотреть статус обращения', en: 'Check ticket status' },
  { name: 'help', emoji: '🆘', ru: 'Справка по боту', en: 'Bot help' },
  { name: 'info', emoji: 'ℹ️', ru: 'Информация о сервере', en: 'Server information' },
  { name: 'viht', emoji: '🔑', ru: 'О сервисе Viht', en: 'About Viht service' },
  { name: 'vpn', emoji: '🌐', ru: 'Информация о VPN', en: 'VPN information' },
  { name: 'vers', emoji: '📦', ru: 'Версия бота', en: 'Bot version' },
  { name: 'register', emoji: '📝', ru: 'Регистрация ключей', en: 'Register keys' },
  { name: 'role', emoji: '🎭', ru: 'Самоназначение ролей', en: 'Self-assign roles' },
  { name: 'remind', emoji: '⏰', ru: 'Установить напоминание', en: 'Set reminder' },
  { name: 'lang', emoji: '🌍', ru: 'Выбрать язык (RU/EN)', en: 'Choose language (RU/EN)' },
  { name: 'music', emoji: '🎵', ru: 'Управление музыкой', en: 'Music control' },
  { name: 'onboarding', emoji: '📨', ru: 'Управление приветственными сообщениями', en: 'Manage welcome messages' },
  { name: 'aiprivacy', emoji: '🔒', ru: 'Управление приватностью ИИ', en: 'AI privacy settings' },
  { name: 'mstop', emoji: '⏹️', ru: 'Просмотр занятости музыкального плеера', en: 'Check music player status' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Список всех доступных команд'),

  async execute(interaction) {
    const lang = (interaction.client && interaction.client.userLangs && interaction.client.userLangs.get(interaction.user.id)) || 'ru';
    const isRu = lang === 'ru';

    const embed = new EmbedBuilder()
      .setTitle(isRu ? '📋 Доступные команды' : '📋 Available commands')
      .setColor(0x2b6cb0)
      .setDescription(isRu ? 'Вот все команды, которые вы можете использовать' : 'Here are all commands you can use');

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
