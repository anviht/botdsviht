const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

const SYMBOLS = ['🍎', '🍊', '🍋', '🍌', '🍓'];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('слот')
    .setDescription('🎰 Крути барабаны в слотах'),

  async execute(interaction) {
    // Проверка канала
    if (!pointSystem.isGameChannelOnly(interaction)) {
      return await interaction.reply({
        content: '❌ Игры доступны только в игровом канале <#1450486721878954006>',
        ephemeral: true
      });
    }

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
      const newPoints = await pointSystem.addPoints(userId, reward, 'slots_win');
      
      try {
        await pointSystem.checkGameAchievements(userId, 'slots', interaction.client);
        await pointSystem.checkPointAchievements(userId, newPoints, interaction.client);
      } catch (e) {}
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
      await pointSystem.notifyReward(interaction, userId, reward, pointSystem.GAME_REWARDS.slots.name, '🎰');
    }
  }
};
