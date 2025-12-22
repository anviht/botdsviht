const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('прижать')
    .setDescription('📌 Прижать участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого прижать?')
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
        content: '❌ Ты не можешь прижать сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя прижимать ботов!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#FF6B9D')
      .setTitle('📌 Прижатие!')
      .setDescription(`${interaction.user} **прижал** ${target} **к стене**`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
