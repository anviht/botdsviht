const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('higher')
    .setDescription('📈 Угадай выше или ниже')
    .addStringOption(option =>
      option
        .setName('выбор')
        .setDescription('Выбери выше или ниже')
        .setRequired(true)
        .addChoices(
          { name: '📈 Выше', value: 'higher' },
          { name: '📉 Ниже', value: 'lower' }
        )
    ),

  async execute(interaction) {
    // Проверка канала
    if (!pointSystem.isGameChannelOnly(interaction)) {
      return await interaction.reply({
        content: '❌ Игры доступны только в игровом канале <#1450486721878954006>',
        ephemeral: true
      });
    }

    const userId = interaction.user.id;
    const choice = interaction.options.getString('выбор');

    // Generate cards
    const firstCard = randInt(2, 11);
    const secondCard = randInt(2, 11);

    // Determine win
    let result = 'draw';
    if (choice === 'higher' && secondCard > firstCard) {
      result = 'win';
    } else if (choice === 'lower' && secondCard < firstCard) {
      result = 'win';
    } else if (secondCard !== firstCard) {
      result = 'loss';
    }

    const reward = result === 'win' ? randInt(15, 25) : 0; // 15-25 при победе

    // Update database
    await db.ensureReady();
    if (result === 'win') {
      await pointSystem.recordGameWin(userId, 'higher', reward);
      const newPoints = await pointSystem.addPoints(userId, reward, 'higher_win');
      
      try {
        await pointSystem.checkGameAchievements(userId, 'higher', interaction.client);
        await pointSystem.checkPointAchievements(userId, newPoints, interaction.client);
      } catch (e) {}
    } else if (result === 'loss') {
      await pointSystem.recordGameLoss(userId, 'higher');
    }

    // Determine card symbols
    const cardSymbols = {
      2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣', 6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣', 10: '🔟', 11: '🏅'
    };

    const resultEmoji = result === 'win' ? '✨' : result === 'loss' ? '💔' : '🤝';
    const resultText = result === 'win' ? 'Угадал!' : result === 'loss' ? 'Не угадал!' : 'Ничья!';

    const embed = new EmbedBuilder()
      .setTitle(`${resultEmoji} ${resultText}`)
      .setColor(result === 'win' ? 0x00AA00 : result === 'loss' ? 0xAA0000 : 0xAAAA00)
      .addFields(
        { name: '🎴 Первая карта', value: cardSymbols[firstCard], inline: true },
        { name: '🎴 Вторая карта', value: cardSymbols[secondCard], inline: true }
      )
      .setFooter({ text: `Ты выбрал: ${choice === 'higher' ? 'Выше' : 'Ниже'} | Награда: ${reward} очков` });

    await interaction.reply({ embeds: [embed] });

    // Notify reward
    if (reward > 0) {
      await pointSystem.notifyReward(interaction, userId, reward, pointSystem.GAME_REWARDS.higher.name, '📈');
    }
  }
};
