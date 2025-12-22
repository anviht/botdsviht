const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('оказать_помощь')
    .setDescription('🤝 Оказать помощь участнику')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кому помочь?')
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
        content: '❌ Ты не можешь помочь сам себе! Попроси у друзей 👥',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Боты не нуждаются в помощи!',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🤝 Помощь!')
      .setDescription(`${interaction.user} **оказал помощь** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
