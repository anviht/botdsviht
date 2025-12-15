const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const points = require('../libs/pointSystem');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('🎡 Рулетка - выигрыш до 150 очков (17% шанс)'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;

    const random = randInt(1, 6);
    const won = random === 3;
    
    const reward = won ? randInt(points.GAME_REWARDS.roulette.base, points.GAME_REWARDS.roulette.max) : 0;

    if (won) {
      await points.recordGameWin(userId, 'roulette', reward);
      const newPoints = await points.addPoints(userId, reward, 'roulette_win');
      
      try {
        await points.checkGameAchievements(userId, interaction.client);
        await points.checkPointAchievements(userId, newPoints, interaction.client);
      } catch (e) {}

      await notifyReward(interaction, userId, reward);
    } else {
      await points.recordGameLoss(userId, 'roulette');
    }

    const chamber = Array(6).fill('💨').map((v, i) => i === 2 ? '💥' : v);
    const chambers = chamber.join('');

    const embed = new EmbedBuilder()
      .setTitle('🎡 Рулетка')
      .setColor(won ? 0xFF6600 : 0xAA0000)
      .addFields(
        { name: 'Барабан', value: chambers, inline: false },
        { name: 'Итог', value: won ? `💥 БУМ! ВЫЖИЛ!\n+${reward} очков` : '💨 Осечка', inline: false }
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
        .setTitle('🎡 Победа в Рулетке!')
        .setDescription(`+${reward} очков`)
        .setColor(0xFF6600)
        .setThumbnail(user.displayAvatarURL());
      
      await user.send({ embeds: [embed] }).catch(() => {});
    }

    const floodChannel = await interaction.client.channels.fetch('1448411376291938336').catch(() => null);
    if (floodChannel) {
      await floodChannel.send(`<@${userId}> 🎡 +${reward} очков в Рулетке!`).catch(() => {});
    }
  } catch (e) {}
}
