const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const variantsВрез = [
  'врезал смачно в лицо',
  'врезал так что упал',
  'врезал так что закружилась голова',
  'врезал с отличной силой',
  'врезал и тот упал прямо',
  'врезал всеми силами',
  'врезал в челюсть',
  'врезал смачно и резко'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('врезать')
    .setDescription('💢 Врезать участнику')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кому врезать?')
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
        content: '❌ Ты не можешь врезать сам себе!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя бить ботов!',
        ephemeral: true
      });
    }

    const variant = variantsВрез[Math.floor(Math.random() * variantsВрез.length)];

    await interaction.reply({ content: `${interaction.user} **${variant}** ${target}` });
  }
};
