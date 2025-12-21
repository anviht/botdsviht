const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('написатьотбота')
    .setDescription('Отправить личное сообщение указанному пользователю')
    .addUserOption(opt => opt.setName('user').setDescription('Кому отправить').setRequired(true))
    .addStringOption(opt => opt.setName('text').setDescription('Текст сообщения').setRequired(true)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const text = interaction.options.getString('text');

    if (!target) return interaction.reply({ content: 'Пользователь не найден.', ephemeral: true });
    if (!text || !text.trim()) return interaction.reply({ content: 'Текст обязателен.', ephemeral: true });

    try {
      await target.send({ content: text });
      return interaction.reply({ content: `Сообщение отправлено пользователю ${target.tag}.`, ephemeral: true });
    } catch (e) {
      console.error('per command error sending DM', e && e.message ? e.message : e);
      return interaction.reply({ content: `Не удалось отправить сообщение. У пользователя возможно закрыты личные сообщения.`, ephemeral: true });
    }
  }
};
