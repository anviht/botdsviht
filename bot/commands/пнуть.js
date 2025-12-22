const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const variantsПинок = [
  'пнул по попе',
  'пнул под зад',
  'пнул в спину',
  'пнул в колено',
  'пнул в пах',
  'пнул прямо в задницу',
  'пнул так, что тот упал'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('пнуть')
    .setDescription('👢 Пнуть участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого пнуть?')
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
        content: '❌ Ты не можешь пнуть сам себя!',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Нельзя пинать ботов!',
        ephemeral: true
      });
    }

    const variant = variantsПинок[Math.floor(Math.random() * variantsПинок.length)];

    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('👢 Пинок!')
      .setDescription(`${interaction.user} **${variant}** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
