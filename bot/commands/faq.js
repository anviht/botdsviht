const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Define all regular user commands with their descriptions
const userCommands = [
  { name: 'profile', emoji: '👤', ru: 'Просмотр профиля и статистики', en: 'View profile and stats' },
  { name: 'daily', emoji: '📅', ru: 'Получить дневную награду', en: 'Get daily reward' },
  { name: 'stats', emoji: '📊', ru: 'Статистика сервера', en: 'Server statistics' },
  { name: 'leaderboard', emoji: '🏆', ru: 'Таблица лидеров', en: 'Leaderboard' },
  { name: 'achievements', emoji: '🎖️', ru: 'Ваши достижения', en: 'Your achievements' },
  { name: 'info', emoji: 'ℹ️', ru: 'Информация о сервере', en: 'Server information' },
  { name: 'viht', emoji: '🔑', ru: 'О сервисе Viht', en: 'About Viht service' },
  { name: 'vpn', emoji: '🌐', ru: 'Информация о VPN', en: 'VPN information' },
  { name: 'vers', emoji: '📦', ru: 'Версия бота', en: 'Bot version' },
  { name: 'remind', emoji: '⏰', ru: 'Установить напоминание', en: 'Set reminder' },
  { name: 'music', emoji: '🎵', ru: 'Управление музыкой', en: 'Music control' },
  { name: 'dice', emoji: '🎲', ru: 'Бросить кубик', en: 'Roll a dice' },
  { name: 'flip', emoji: '🪙', ru: 'Подбросить монету', en: 'Flip a coin' },
  { name: 'roulette', emoji: '🎡', ru: 'Русская рулетка', en: 'Russian roulette' },
  { name: 'rockpaper', emoji: '✂️', ru: 'Камень-Ножницы-Бумага', en: 'Rock-Paper-Scissors' },
  { name: 'slots', emoji: '🎰', ru: 'Слоты', en: 'Slots' },
  { name: 'higher', emoji: '📈', ru: 'Выше/Ниже', en: 'Higher/Lower' },
  { name: 'support', emoji: '🆘', ru: '⚠️ ТОЛЬКО ОСНОВАТЕЛЬ - Создать тикет', en: '⚠️ FOUNDER ONLY - Create ticket' },
  { name: 'ticket', emoji: '🎫', ru: '⚠️ ТОЛЬКО ОСНОВАТЕЛЬ - Статус тикета', en: '⚠️ FOUNDER ONLY - Ticket status' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('📚 Список всех команд для пользователей'),

  async execute(interaction) {
    const lang = (interaction.client && interaction.client.userLangs && interaction.client.userLangs.get(interaction.user.id)) || 'ru';
    const isRu = lang === 'ru';

    const embed = new EmbedBuilder()
      .setTitle(isRu ? '📚 КОМАНДЫ ПОЛЬЗОВАТЕЛЕЙ' : '📚 USER COMMANDS')
      .setColor(0x3498db)
      .setDescription(isRu ? 
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📖 Все доступные команды для вас\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' : 
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📖 All available commands for you\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      );

    // Group commands by category
    const categories = {
      profile: [],
      economy: [],
      games: [],
      info: [],
      media: [],
      restricted: []
    };

    const categoryEmojis = {
      profile: '👤',
      economy: '💰',
      games: '🎮',
      info: 'ℹ️',
      media: '🎵',
      restricted: '⚠️'
    };

    // Categorize commands
    const profileCmds = ['profile', 'stats', 'achievements'];
    const economyCmds = ['daily', 'leaderboard'];
    const gameCmds = ['dice', 'flip', 'roulette', 'rockpaper', 'slots', 'higher'];
    const infoCmds = ['info', 'viht', 'vpn', 'vers', 'remind'];
    const mediaCmds = ['music'];
    const restrictedCmds = ['support', 'ticket'];

    for (const cmd of userCommands) {
      let cat = 'restricted';
      if (profileCmds.includes(cmd.name)) cat = 'profile';
      else if (economyCmds.includes(cmd.name)) cat = 'economy';
      else if (gameCmds.includes(cmd.name)) cat = 'games';
      else if (infoCmds.includes(cmd.name)) cat = 'info';
      else if (mediaCmds.includes(cmd.name)) cat = 'media';
      
      categories[cat].push(cmd);
    }

    // Add category fields
    for (const [cat, cmds] of Object.entries(categories)) {
      if (cmds.length === 0) continue;
      
      const lines = cmds.map(cmd => 
        `${cmd.emoji} \`/${cmd.name}\` — ${isRu ? cmd.ru : cmd.en}`
      ).join('\n');
      
      const catName = isRu ? 
        (cat === 'profile' ? '👤 Профиль' : 
         cat === 'economy' ? '💰 Экономика' :
         cat === 'games' ? '🎮 Игры' :
         cat === 'info' ? 'ℹ️ Информация' :
         cat === 'media' ? '🎵 Медиа' :
         '⚠️ Ограниченные команды') :
        (cat === 'profile' ? '👤 Profile' :
         cat === 'economy' ? '💰 Economy' :
         cat === 'games' ? '🎮 Games' :
         cat === 'info' ? 'ℹ️ Information' :
         cat === 'media' ? '🎵 Media' :
         '⚠️ Restricted Commands');
      
      embed.addFields({ 
        name: catName,
        value: lines,
        inline: false
      });
    }

    embed.addFields({
      name: isRu ? '\n━━━━━━━━━━━━━━━━━━━━━━━━━━' : '\n━━━━━━━━━━━━━━━━━━━━━━━━━━',
      value: isRu ? 
        '💡 Для администраторских команд используй `/afaq`\n' +
        '❓ Напиши `/help` для справки по боту' :
        '💡 Use `/afaq` for admin commands\n' +
        '❓ Type `/help` for bot help'
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
