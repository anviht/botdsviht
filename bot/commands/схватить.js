const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('схватить')
    .setDescription('🖐️ Схватить участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого схватить?')
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
        content: '❌ Ты не можешь схватить сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя хватать ботов!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('🖐️ Захват!')
      .setDescription(`${interaction.user} **схватил** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
