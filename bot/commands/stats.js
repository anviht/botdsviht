const { SlashCommandBuilder, EmbedBuilder, ProgressBarOptions } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('статистика')
    .setDescription('📊 Просмотр расширенной статистики игрока')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь (по умолчанию вы)').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    const gameStats = db.get('gameStats') || {};
    const userStats = gameStats[userId] || { 
      points: 0, 
      wins: 0, 
      losses: 0, 
      messagesCount: 0,
      gamesPlayed: {},
      achievements: []
    };

    const points = userStats.points || 0;
    const level = Math.floor(points / 100) + 1;
    const progressToNextLevel = points % 100;
    const totalGames = userStats.wins + userStats.losses;
    const winRate = totalGames > 0 ? ((userStats.wins / totalGames) * 100).toFixed(1) : 0;

    // Progress bar
    const barLength = 20;
    const filledBars = Math.floor((progressToNextLevel / 100) * barLength);
    const emptyBars = barLength - filledBars;
    const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

    const embed = new EmbedBuilder()
      .setTitle(`📊 Статистика ${targetUser.username}`)
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 128 }))
      .addFields(
        { name: '📊 Уровень и очки', value: `Уровень: **${level}**\nОчки: **${points}**\nПрогресс: \`${progressBar}\` ${progressToNextLevel}/100`, inline: false },
        { name: '🎮 Игры', value: `Всего игр: **${totalGames}**\nПобед: **${userStats.wins}** 🏆\nПоражений: **${userStats.losses}** 💀\nПроцент побед: **${winRate}%**`, inline: true },
        { name: '💬 Сообщения', value: `Всего сообщений: **${userStats.messagesCount}** 💬\nДостижений разблокировано: **${(userStats.achievements || []).length}** 🏅`, inline: true }
      )
      .setFooter({ text: 'Играйте в игры, пишите сообщения и зарабатывайте очки!' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
