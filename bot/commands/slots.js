const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

const SYMBOLS = ['🍎', '🍊', '🍋', '🍌', '🍓'];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('🎰 Крути барабаны в слотах'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // Spin three reels
    const reel1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const reel2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const reel3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    // Check win: need at least 2 matching
    const won = reel1 === reel2 || reel2 === reel3 || reel1 === reel3;
    const reward = won ? randInt(50, 200) : 0; // 50-200 при победе

    // Update database
    await db.ensureReady();
    if (won) {
      await pointSystem.recordGameWin(userId, 'slots', reward);
    } else {
      await pointSystem.recordGameLoss(userId, 'slots');
    }

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(`🎰 Слоты`)
      .setColor(won ? 0x00AA00 : 0xAA0000)
      .setDescription(`\`${reel1} │ ${reel2} │ ${reel3}\``)
      .setFooter({ text: won ? `🎉 Ты выиграл ${reward} очков!` : '😢 Попробуй ещё раз!' });

    await interaction.reply({ embeds: [embed] });

    // Notify reward
    if (won) {
      await notifyReward(interaction, userId, reward, 'Слоты', '🎰');
      
      // Check achievements
      await pointSystem.checkGameAchievements(userId, 'slots', interaction.client);
      await pointSystem.checkPointAchievements(userId, interaction.client);
    }
  }
};

async function notifyReward(interaction, userId, reward, gameName, emoji) {
  try {
    // DM notification
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle(`${emoji} Победа в ${gameName}!`)
        .setDescription(`+${reward} очков`)
        .setColor(0x00AA00)
        .setThumbnail(user.displayAvatarURL());
      await user.send({ embeds: [embed] }).catch(() => {});
    }

    // Flood channel notification
    const floodChannel = await interaction.client.channels.fetch('1448411376291938336').catch(() => null);
    if (floodChannel) {
      await floodChannel.send(`<@${userId}> ${emoji} +${reward} очков в ${gameName}`).catch(() => {});
    }
  } catch (e) {
    console.warn('Notify reward error:', e && e.message ? e.message : e);
  }
}
