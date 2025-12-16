const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const points = require('../libs/pointSystem');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('🎲 Кубики - выигрыш до 30 очков'),

  async execute(interaction) {
    // Проверка канала
    if (!points.isGameChannelOnly(interaction)) {
      return await interaction.reply({
        content: '❌ Игры доступны только в игровом канале <#1450486721878954006>',
        ephemeral: true
      });
    }

    await db.ensureReady();
    const userId = interaction.user.id;

    const roll = randInt(1, 6);
    const userRoll = randInt(1, 6);
    const won = userRoll >= roll;
    
    const reward = won ? randInt(points.GAME_REWARDS.dice.base, points.GAME_REWARDS.dice.max) : 0;

    if (won) {
      await points.recordGameWin(userId, 'dice', reward);
      const newPoints = await points.addPoints(userId, reward, 'dice_win');
      
      try {
        await points.checkGameAchievements(userId, 'dice', interaction.client);
        await points.checkPointAchievements(userId, newPoints, interaction.client);
      } catch (e) {}

      await points.notifyReward(interaction, userId, reward, points.GAME_REWARDS.dice.name, '🎲');
    } else {
      await points.recordGameLoss(userId, 'dice');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎲 Кубики')
      .setColor(won ? 0x00AA00 : 0xAA0000)
      .addFields(
        { name: 'Твой бросок', value: `🎲 **${userRoll}**`, inline: true },
        { name: 'Бросок бота', value: `🎲 **${roll}**`, inline: true },
        { name: 'Итог', value: won ? `✅ ПОБЕДА!\n+${reward} очков` : '❌ Поражение', inline: false }
      );

    await interaction.reply({ embeds: [embed] });
  }
};
