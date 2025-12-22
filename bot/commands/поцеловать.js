const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const variantsПоцеловать = [
  'поцеловал в щеку',
  'поцеловал в лоб',
  'поцеловал в руку',
  'поцеловал нежно',
  'поцеловал и улыбнулся'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('поцеловать')
    .setDescription('💋 Поцеловать участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого поцеловать?')
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
        content: '❌ Ты не можешь поцеловать сам себя! Стесняешься? 😳',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Ботам не нужны поцелуи!',
        ephemeral: true
      });
    }

    const variant = variantsПоцеловать[Math.floor(Math.random() * variantsПоцеловать.length)];

    const embed = new EmbedBuilder()
      .setColor('#FF1493')
      .setTitle('💋 Поцелуй!')
      .setDescription(`${interaction.user} **${variant}** ${target}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
