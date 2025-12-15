const { SlashCommandBuilder } = require('discord.js');
const reviewsCmd = require('./reviews');

const ALLOWED_ROLE_ID = '1436485697392607303'; // Founder

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recount-reviews')
    .setDescription('🔄 Пересчитать количество отзывов (админ)'),

  async execute(interaction) {
    // Проверка роли
    const member = interaction.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const success = await reviewsCmd.recountReviews(interaction.client);
      
      if (success) {
        await interaction.editReply({
          content: '✅ Счётчик отзывов успешно пересчитан!'
        });
      } else {
        await interaction.editReply({
          content: '❌ Ошибка при пересчёте счётчика'
        });
      }
    } catch (error) {
      console.error('recount-reviews error:', error);
      await interaction.editReply({
        content: `❌ Ошибка: ${error.message}`
      });
    }
  }
};
