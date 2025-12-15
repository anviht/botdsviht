const { SlashCommandBuilder } = require('discord.js');
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

    // Получить информацию о пользователях
    let leaderboardText = '🏆 **ЛИДЕРБОРД ОЧКОВ** 🏆\n';
    leaderboardText += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    let rank = 1;
    for (const user of top10) {
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#️⃣`;
      const padding = rank < 10 ? ' ' : '';
      
      // Получить имя пользователя
      let userName = `<@${user.userId}>`;
      try {
        const discordUser = await interaction.client.users.fetch(user.userId).catch(() => null);
        if (discordUser) {
          userName = `**${discordUser.username}**`;
        }
      } catch (e) {}
      
      leaderboardText += `${medal} ${padding}${rank}. ${userName}\n`;
      leaderboardText += `   ⭐ ${user.points} очков | 📊 Уровень ${user.level}\n\n`;
      rank++;
    }

    leaderboardText += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    leaderboardText += 'Очки из игр, вех сообщений и достижений';

    await interaction.reply({
      content: leaderboardText,
      ephemeral: true
    });
  }
};
