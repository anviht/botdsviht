const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const points = require('../libs/pointSystem');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('flip')
    .setDescription('🪙 Орёл/Решка - выигрыш до 15 очков'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;

    const coinFlip = randInt(0, 1);
    const userGuess = randInt(0, 1);
    const won = coinFlip === userGuess;
    
    const reward = won ? randInt(points.GAME_REWARDS.flip.base, points.GAME_REWARDS.flip.max) : 0;

    if (won) {
      await points.recordGameWin(userId, 'flip', reward);
      const newPoints = await points.addPoints(userId, reward, 'flip_win');
      
      try {
        await points.checkGameAchievements(userId, interaction.client);
        await points.checkPointAchievements(userId, newPoints, interaction.client);
      } catch (e) {}

      await notifyReward(interaction, userId, reward);
    } else {
      await points.recordGameLoss(userId, 'flip');
    }

    const coinResult = coinFlip === 0 ? '🦅 **ОРЁЛ**' : '🪙 **РЕШКА**';
    const userResult = userGuess === 0 ? '🦅 Орёл' : '🪙 Решка';

    const embed = new EmbedBuilder()
      .setTitle('🪙 Орёл/Решка')
      .setColor(won ? 0x00AA00 : 0xAA0000)
      .addFields(
        { name: 'Твой выбор', value: userResult, inline: true },
        { name: 'Результат', value: coinResult, inline: true },
        { name: 'Итог', value: won ? `✅ ПОБЕДА!\n+${reward} очков` : '❌ Поражение', inline: false }
      );

    await interaction.reply({ embeds: [embed] });
  }
};

async function notifyReward(interaction, userId, reward) {
  try {
    if (reward === 0) return;

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle('🪙 Победа в Орёл/Решка!')
        .setDescription(`+${reward} очков`)
        .setColor(0x00AA00)
        .setThumbnail(user.displayAvatarURL());
      
      await user.send({ embeds: [embed] }).catch(() => {});
    }

    const floodChannel = await interaction.client.channels.fetch('1448411376291938336').catch(() => null);
    if (floodChannel) {
      await floodChannel.send(`<@${userId}> 🪙 +${reward} очков в Орёл/Решка`).catch(() => {});
    }
  } catch (e) {}
}
