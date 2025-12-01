const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Admin commands with descriptions - same list as in faq.js
const adminCommands = [
  { name: 'ticket', emoji: '🎫', ru: 'Посмотреть статус обращения', en: 'Check ticket status' },
  { name: 'register', emoji: '📝', ru: 'Регистрация ключей', en: 'Register keys' },
  { name: 'role', emoji: '🎭', ru: 'Самоназначение ролей', en: 'Self-assign roles' },
  { name: 'lang', emoji: '🌍', ru: 'Выбрать язык (RU/EN)', en: 'Choose language (RU/EN)' },
  { name: 'onboarding', emoji: '📨', ru: 'Управление приветственными сообщениями', en: 'Manage welcome messages' },
  { name: 'aiprivacy', emoji: '🔒', ru: 'Управление приватностью ИИ', en: 'AI privacy settings' },
  { name: 'mstop', emoji: '⏹️', ru: 'Просмотр занятости музыкального плеера', en: 'Check music player status' },
  { name: 'clearchat', emoji: '🗑️', ru: 'Очистить чат (удалить множество сообщений)', en: 'Clear chat (bulk delete messages)' },
  { name: 'setvpn', emoji: '🌐', ru: 'Установить статус VPN', en: 'Set VPN status' },
  { name: 'admfaq', emoji: '👑', ru: 'Список администраторских команд (этот список)', en: 'Admin commands list (this list)' },
];

const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admfaq')
    .setDescription('👑 Справка по администраторским командам'),

  async execute(interaction) {
    // Check if user has admin role
    const member = interaction.member;
    const isAdmin = member && member.roles && member.roles.cache && config.adminRoles && config.adminRoles.some(rid => member.roles.cache.has(rid));

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
