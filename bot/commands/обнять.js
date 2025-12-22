const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const variantsОбнять = [
  'обнял крепко',
  'обнял с любовью',
  'обнял теплом',
  'обнял дружески',
  'обнял и улыбнулся',
  'дал большое объятие'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('обнять')
    .setDescription('🤗 Обнять участника')
    .addUserOption(option =>
      option
        .setName('участник')
        .setDescription('Кого обнять?')
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
        content: '❌ Ты не можешь обнять сам себя! Найди друга 💙',
        ephemeral: true
      });
    }

    if (target.bot) {
      return await interaction.reply({
        content: '❌ Ботам не нравятся объятия!',
        ephemeral: true
      });
    }

    const variant = variantsОбнять[Math.floor(Math.random() * variantsОбнять.length)];

    await interaction.reply({ content: `${interaction.user} **${variant}** ${target}` });
  }
};
