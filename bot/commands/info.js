const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('инфо')
    .setDescription('ℹ️ Информация о пользователе (ваша или указанного пользователя)')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь для отображения информации').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;

    const embed = new EmbedBuilder()
      .setTitle(`Информация — ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ forceStatic: false }))
      .setColor(0x9b59b6)
      .addFields(
        { name: 'Имя', value: `${target.tag}`, inline: true },
        { name: 'ID', value: `${target.id}`, inline: true },
        { name: 'Аккаунт создан', value: `<t:${Math.floor(target.createdTimestamp/1000)}:F>`, inline: false }
      );

    if (member) {
      embed.addFields(
        { name: 'Заход на сервер', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp/1000)}:F>` : 'Неизвестно', inline: true },
        { name: 'Ролей', value: `${member.roles.cache.size - 1}`, inline: true },
        { name: 'Высшая роль', value: member.roles.highest ? `${member.roles.highest}` : 'Нет', inline: false }
      );
    }

    await interaction.reply({ embeds: [embed] });
  }
};
