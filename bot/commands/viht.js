const { SlashCommandBuilder } = require('discord.js');
const { sendPrompt } = require('../ai/vihtAi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('вихт')
    .setDescription('🔑 Информация о сервисе Viht и его возможностях')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Ваш запрос к Viht AI')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });
    const prompt = interaction.options.getString('prompt');
    try {
      const answer = await sendPrompt(prompt);
      // Guard: Discord field must be < 2000 chars
      const out = String(answer).slice(0, 1990);
      await interaction.editReply(out || 'Пустой ответ от AI.');
    } catch (err) {
      console.error('AI error:', err);
      await interaction.editReply('Ошибка при обращении к AI. Проверьте логи.');
    }
  }
};
