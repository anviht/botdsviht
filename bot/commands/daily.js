const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('бонус')
    .setDescription('🎁 Получить ежедневный бонус репутации (1 раз в 24 часа)'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;
    const now = Date.now();

    // Get daily rewards data
    const dailyRewards = db.get('dailyRewards') || {};
    if (!dailyRewards[userId]) dailyRewards[userId] = { lastClaim: 0, streak: 0 };

    const lastClaim = dailyRewards[userId].lastClaim;
    const streak = dailyRewards[userId].streak || 0;
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);

    if (hoursSinceLastClaim < 24) {
      const hoursLeft = Math.ceil(24 - hoursSinceLastClaim);
      return await interaction.reply({
        content: `⏳ Вы уже получили награду! Попробуйте через ${hoursLeft} часов.`,
        ephemeral: true
      });
    }

    // Calculate reward
    const baseReward = 5;
    const streakBonus = Math.min(streak * 2, 20); // max +20 за серию
    const totalReward = baseReward + streakBonus;
    const newStreak = streak + 1;

    // Update daily rewards
    dailyRewards[userId] = { lastClaim: now, streak: newStreak };
    await db.set('dailyRewards', dailyRewards);

    // Give reputation to gameStats.totalRep as well
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) gameStats[userId] = { wins: 0, losses: 0, totalRep: 0 };
    gameStats[userId].totalRep = (gameStats[userId].totalRep || 0) + totalReward;
    await db.set('gameStats', gameStats);

    // Awards (daily achievements + first command)
    try {
      const ach = require('../libs/achievements');
      await ach.checkFirstCommand(userId, interaction);
      await ach.checkDailyAchievements(userId, interaction);
      await ach.checkGameAchievements(userId, interaction);
    } catch (e) {}

    const embed = new EmbedBuilder()
      .setTitle('🎁 Ежедневный бонус')
      .setColor(0xFFAA00)
      .addFields(
        { name: 'Базовая награда', value: `⭐ **${baseReward}** репутация`, inline: true },
        { name: 'Бонус за серию', value: `🔥 **${streakBonus}** репутация (день ${newStreak})`, inline: true },
        { name: 'Всего получено', value: `✨ **${totalReward}** репутация`, inline: false }
      )
      .setFooter({ text: `Ваша серия: ${newStreak} дней подряд! Продолжайте так!` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
