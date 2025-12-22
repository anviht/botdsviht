const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('пригрозить')
    .setDescription('☠️ Пригрозить участнику')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кому пригрозить?')
        .setRequired(true)
    ),

  async execute(interaction) {
    const RP_CHANNEL_ID = '1452769544484683959';
    
    if (interaction.channelId !== RP_CHANNEL_ID) {
      return await interaction.reply({
        content: '❌ РП команды доступны только в канале рп',
        ephemeral: true
      });
    }
    
    const target = interaction.options.getUser('участник');
    
    if (target.id === interaction.user.id) {
      return await interaction.reply({
        content: '❌ Ты не можешь пригрозить сам себе!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя пугать ботов!',
        ephemeral: true
      });
    }

    await interaction.reply({ content: `${interaction.user} **пригрозил** ${target}` });
  }
};
