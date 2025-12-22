const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('застрелить')
    .setDescription('🔫 Застрелить участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого застрелить?')
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
        content: '❌ Ты не можешь застрелить сам себя! Позови помощника 🆘',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя стрелять по ботам!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#DC143C')
      .setTitle('🔫 Выстрел!')
      .setDescription(`${interaction.user} **застрелил** ${target} **пиф-паф!**`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
