const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('повалить')
    .setDescription('⬇️ Повалить участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого повалить?')
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
        content: '❌ Ты не можешь повалить сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя валить ботов!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#E91E63')
      .setTitle('⬇️ Падение!')
      .setDescription(`${interaction.user} **повалил** ${target} **на землю**`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
