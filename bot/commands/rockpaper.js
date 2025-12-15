const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

const CHOICES = {
  'rock': { emoji: '🪨', name: 'Камень', beats: 'scissors' },
  'scissors': { emoji: '✂️', name: 'Ножницы', beats: 'paper' },
  'paper': { emoji: '📄', name: 'Бумага', beats: 'rock' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rockpaper')
    .setDescription('✂️ Играй в Камень-Ножницы-Бумага')
    .addStringOption(option =>
      option
        .setName('выбор')
        .setDescription('Твой выбор')
        .setRequired(true)
        .addChoices(
          { name: '🪨 Камень', value: 'rock' },
          { name: '✂️ Ножницы', value: 'scissors' },
          { name: '📄 Бумага', value: 'paper' }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const userChoice = interaction.options.getString('выбор');

    // Bot's random choice
    const choices = Object.keys(CHOICES);
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    // Determine outcome
    let result = 'draw';
    if (CHOICES[userChoice].beats === botChoice) {
      result = 'win';
    } else if (CHOICES[botChoice].beats === userChoice) {
      result = 'loss';
    }

    const reward = result === 'win' ? Math.floor(Math.random() * 16) + 25 : 0; // 25-40 при победе
    const earnedPoints = result === 'win' ? reward : 0;

    // Update database
    await db.ensureReady();
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {} };
    }

    if (result === 'win') {
      await pointSystem.recordGameWin(userId, 'rockpaper', earnedPoints);
    } else if (result === 'loss') {
      await pointSystem.recordGameLoss(userId, 'rockpaper');
    }

    // Embed
    const resultEmoji = result === 'win' ? '✨' : result === 'loss' ? '💔' : '🤝';
    const resultText = result === 'win' ? 'Ты выиграл!' : result === 'loss' ? 'Ты проиграл!' : 'Ничья!';

    const embed = new EmbedBuilder()
      .setTitle(`${resultEmoji} ${resultText}`)
      .setColor(result === 'win' ? 0x00AA00 : result === 'loss' ? 0xAA0000 : 0xAAAA00)
      .addFields(
        { name: '👤 Твой выбор', value: `${CHOICES[userChoice].emoji} ${CHOICES[userChoice].name}`, inline: true },
        { name: '🤖 Выбор бота', value: `${CHOICES[botChoice].emoji} ${CHOICES[botChoice].name}`, inline: true }
      )
      .setFooter({ text: `Заработано: ${earnedPoints} очков` });

    if (earnedPoints > 0) {
      embed.addFields({ name: '💰 Награда', value: `+${earnedPoints} очков`, inline: false });
    }

    await interaction.reply({ embeds: [embed] });

    // Notify reward
    if (earnedPoints > 0) {
      await notifyReward(interaction, userId, earnedPoints, 'Камень-Ножницы-Бумага', '✂️');
      
      // Check achievements
      await pointSystem.checkGameAchievements(userId, 'rockpaper', interaction.client);
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
