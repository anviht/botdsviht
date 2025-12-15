const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('🏅 Просмотр ваших достижений')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь (по умолчанию вы)').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    const gameStats = db.get('gameStats') || {};
    const userStats = gameStats[userId] || { achievements: [] };
    const userAchievements = userStats.achievements || [];

    const achievements = pointSystem.ACHIEVEMENTS;
    
    const embed = new EmbedBuilder()
      .setTitle(`🏅 Достижения ${targetUser.username}`)
      .setColor(0xFFD700)
      .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 128 }))
      .setDescription(`Получено достижений: **${userAchievements.length}/${Object.keys(achievements).length}**\n\n`);

    // Group achievements by category
    const categories = {
      'Базовые': ['first_command', 'first_game', 'first_message'],
      'Очки': ['points_500', 'points_2000', 'points_5000', 'points_10000', 'points_25000'],
      'Победы': ['wins_25', 'wins_100', 'wins_500'],
      'Сообщения': ['messages_1000', 'messages_10000', 'messages_50000'],
      'Специальные': ['win_streak_10', 'play_all_games', 'level_50', 'level_100']
    };

    for (const [category, achievementIds] of Object.entries(categories)) {
      let categoryText = `\n**${category}:**\n`;
      for (const achievementId of achievementIds) {
        const ach = achievements[achievementId];
        if (!ach) continue;
        const unlocked = userAchievements.includes(achievementId);
        const status = unlocked ? '✅' : '🔒';
        categoryText += `${status} **${ach.name}** - ${ach.description}\n`;
      }
      if (categoryText.trim().length > category.length + 5) {
        embed.addFields({ name: '\u200b', value: categoryText, inline: false });
      }
    }

    embed.setFooter({ text: 'Разблокируй все достижения и станешь легендой!' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
