const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('удержать')
    .setDescription('🚫 Удержать участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого удержать?')
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
        content: '❌ Ты не можешь удержать сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя держать ботов!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#00BCD4')
      .setTitle('🚫 Удержание!')
      .setDescription(`${interaction.user} **удерживает** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
