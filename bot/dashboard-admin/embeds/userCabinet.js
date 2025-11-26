// User cabinet embeds
const { EmbedBuilder } = require('discord.js');

function createUserInfoEmbed(member) {
  const created = member.user.createdAt;
  const createdStr = `${String(created.getDate()).padStart(2,'0')}.${String(created.getMonth()+1).padStart(2,'0')}.${created.getFullYear()}`;
  const joined = member.joinedAt;
  const joinedStr = joined ? `${String(joined.getDate()).padStart(2,'0')}.${String(joined.getMonth()+1).padStart(2,'0')}.${joined.getFullYear()}` : '—';
  
  let rolesList = 'Нет ролей';
  if (member.roles && member.roles.cache) {
    const filtered = member.roles.cache.filter(r => r.id !== member.guild.id);
    if (filtered.size > 0) rolesList = filtered.map(r => r.name).join(', ');
  }

  return new EmbedBuilder()
    .setTitle(`👤 Личный кабинет — ${member.user.username}`)
    .setColor(0x2F3136)
    .addFields(
      { name: 'Тег', value: member.user.tag, inline: true },
      { name: 'ID', value: member.id, inline: true },
      { name: 'Дата регистрации', value: createdStr, inline: true },
      { name: 'Вступил на сервер', value: joinedStr, inline: true },
      { name: 'Роли', value: rolesList, inline: false }
    )
    .setThumbnail(member.user.avatarURL({ dynamic: true }))
    .setTimestamp();
}

function createUserStatusEmbed(member, presidentData) {
  let status = '👤 Обычный пользователь';
  let statusDetails = '';
  
  if (member.roles.cache.has('1436485697392607303')) {
    status = '👑 Администратор';
  } else if (member.roles.cache.has('1443200454795329616')) {
    status = '🏛️ Президент';
    if (presidentData) {
      const remainingDays = Math.ceil((presidentData.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
      statusDetails = `Избран: ${new Date(presidentData.electedAt).toLocaleDateString('ru-RU')}\nДней осталось: ${remainingDays}`;
    }
  } else if (member.roles.cache.has('1441744621641400353')) {
    status = '✅ Подписчик';
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 Мой статус')
    .setColor(0x2F3136)
    .addFields(
      { name: 'Статус', value: status, inline: false }
    );

  if (statusDetails) {
    embed.addFields({ name: 'Детали', value: statusDetails, inline: false });
  }

  embed.setTimestamp();
  return embed;
}

function createBalanceEmbed(member) {
  return new EmbedBuilder()
    .setTitle('💰 Баланс')
    .setColor(0x2F3136)
    .addFields(
      { name: 'Баланс', value: '0.00 ₽', inline: false },
      { name: 'Статус', value: 'В разработке', inline: false }
    )
    .setTimestamp();
}

function createCommandsEmbed() {
  return new EmbedBuilder()
    .setTitle('📋 Доступные команды')
    .setColor(0x2F3136)
    .addFields(
      { name: '/viht', value: 'Поговорить с AI ботом', inline: false },
      { name: '/help', value: 'Получить справку', inline: false },
      { name: '/info', value: 'Информация о боте', inline: false }
    )
    .setFooter({ text: 'Используйте слэш-команды в любом канале' })
    .setTimestamp();
}

module.exports = {
  createUserInfoEmbed,
  createUserStatusEmbed,
  createBalanceEmbed,
  createCommandsEmbed
};
