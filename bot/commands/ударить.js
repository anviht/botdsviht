const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const variantsУдар = [
  'ударил в лицо',
  'ударил в живот',
  'ударил в спину',
  'ударил в плечо',
  'ударил в грудь',
  'ударил в бок',
  'ударил прямо в голову',
  'ударил с размаху в лицо'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ударить')
    .setDescription('⚔️ Ударить участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого ударить?')
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
        content: '❌ Ты не можешь ударить сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя бить ботов!',
        ephemeral: true
      });
    }

    const variant = variantsУдар[Math.floor(Math.random() * variantsУдар.length)];

    const embed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle('⚔️ Удар!')
      .setDescription(`${interaction.user} **${variant}** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
