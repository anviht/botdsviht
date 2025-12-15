const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('🏆 Топ-10 пользователей по очкам'),

  async execute(interaction) {
    await db.ensureReady();
    const gameStats = db.get('gameStats') || {};

    // Get all users with points
    const userScores = [];
    for (const [userId, stats] of Object.entries(gameStats)) {
      const points = stats.points || 0;
      const level = Math.floor(points / 100) + 1;
      if (points > 0) {
        userScores.push({ userId, points, level });
      }
    }

    // Sort by points
    userScores.sort((a, b) => b.points - a.points);
    const top10 = userScores.slice(0, 10);

    if (top10.length === 0) {
      return await interaction.reply({
        content: 'На сервере ещё нет активных пользователей.',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🏆 Лидерборд очков')
      .setColor(0xFFD700)
      .setDescription('Топ-10 активных членов сообщества')
      .setTimestamp();

    let rank = 1;
    for (const user of top10) {
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      embed.addFields({
        name: `${medal} <@${user.userId}>`,
        value: `⭐ **${user.points}** очков | 📊 **Уровень ${user.level}**`,
        inline: false
      });
      rank++;
    }

    embed.setFooter({ text: 'Очки из игр, вех сообщений и достижений' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
