const { EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

const SUBSCRIBER_ROLE_ID = process.env.SUBSCRIBER_ROLE_ID || '1441744621641400353';
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '1436487981723680930';

async function sendWelcomeMessage(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.warn('Channel not found for welcome message:', channelId);
    return null;
  }

  // Check bot permissions in the channel and fail gracefully if missing
  const botMember = channel.guild?.members?.cache?.get(client.user.id) || await channel.guild?.members?.fetch(client.user.id).catch(() => null);
  const perms = channel.permissionsFor ? channel.permissionsFor(botMember || client.user) : null;
  const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AddReactions', 'ReadMessageHistory'];
  const missing = perms ? needed.filter(p => !perms.has(p)) : needed;
  if (missing.length) {
    console.warn('Missing channel permissions for welcome message:', missing.join(', '), 'Channel:', channelId);
    // do not throw — fail gracefully so bot remains up
    return null;
  }

  const embed = new EmbedBuilder()
    .setTitle('Добро пожаловать на сервер Viht VPN')
    .setColor(0x1abc9c)
    .setDescription('Добро пожаловать! Здесь собирается сообщество вокруг экосистемы Viht: решения по VPN и защите данных, интеграции с AI, разработка сайтов и ботов.')
    .addFields(
      { name: 'О канале', value: 'Здесь вы найдёте обсуждения по VPN, безопасности, интеграциям AI и помощи при создании сайтов и ботов. Мы ценим конфиденциальность и надёжность.' },
      { name: 'Получить роль', value: `Поставьте реакцию ✅ под этим сообщением, чтобы получить роль <@&${SUBSCRIBER_ROLE_ID}>.` }
    )
    .setFooter({ text: 'Нажмите ✅, чтобы подтвердить, что вы ознакомились с правилами и хотите получить роль Подписчик.' });

  try {
    const msg = await channel.send({ embeds: [embed] });
    // Try to react; if it fails (permissions), log but don't throw
    try { await msg.react('✅'); } catch (e) { console.warn('Could not add reaction to welcome message:', e.message || e); }
    // save message id to db so we can track reactions
    if (db && db.set) await db.set('welcome', { channelId, messageId: msg.id });
    return msg.id;
  } catch (err) {
    console.warn('Failed to send welcome message (caught):', err && err.message ? err.message : err);
    return null;
  }
}

async function handleReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();
    const rec = db.get && db.get('welcome') && db.get('welcome').value ? db.get('welcome').value() : db.get('welcome');
    if (!rec) return;
    if (reaction.message.id !== rec.messageId) return;
    if (reaction.emoji.name !== '✅') return;
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.get(SUBSCRIBER_ROLE_ID) || await guild.roles.fetch(SUBSCRIBER_ROLE_ID).catch(() => null);
    if (!role) {
      console.warn('Subscriber role not found:', SUBSCRIBER_ROLE_ID);
      // inform channel so admin can fix
      try { await reaction.message.channel.send(`Не могу найти роль Подписчик (ID ${SUBSCRIBER_ROLE_ID}). Проверьте, что роль создана.`); } catch (e) { /* ignore */ }
      return;
    }

    // Check role hierarchy: bot must have a higher role than the role it assigns
    const botMember = await guild.members.fetch(reaction.message.client.user.id).catch(() => null);
    const botHighestPos = botMember && botMember.roles && botMember.roles.highest ? botMember.roles.highest.position : -1;
    const targetPos = role.position || -1;
    if (botHighestPos <= targetPos) {
      console.warn(`Cannot assign role ${role.id} — bot role position (${botHighestPos}) <= target role position (${targetPos})`);
      try {
        await reaction.message.channel.send(`Не могу выдать роль <@&${SUBSCRIBER_ROLE_ID}> — роль бота ниже по иерархии. Поднимите роль бота выше роли Подписчик и убедитесь, что у бота есть право "Управлять ролями".`);
      } catch (e) { /* ignore */ }
      return;
    }

    // Try to add the role (may still fail if permissions missing)
    try {
      await member.roles.add(role.id ? role.id : role);

      // After successful role assignment, post a welcome/announcement message to the announce channel
      try {
        const announceChannel = await reaction.message.client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
        if (announceChannel) {
          // check send permissions
          const botMember = announceChannel.guild?.members?.cache?.get(reaction.message.client.user.id) || await announceChannel.guild?.members?.fetch(reaction.message.client.user.id).catch(() => null);
          const perms = announceChannel.permissionsFor ? announceChannel.permissionsFor(botMember || reaction.message.client.user) : null;
          const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
          const missing = perms ? needed.filter(p => !perms.has(p)) : needed;
          if (missing.length === 0) {
            // Use user's tag (username#discriminator) in announcement and include id
            const welcomeEmbed = new EmbedBuilder()
              .setTitle(`🎉 Приветствуем, ${member.user.tag}`)
              .setColor(0x00AE86)
              .addFields(
                { name: 'Пользователь', value: `${member.user.tag} (<@${member.id}>)`, inline: false },
                { name: 'ID пользователя', value: `${member.id}`, inline: true },
                { name: 'Роль выдана', value: `<@&${SUBSCRIBER_ROLE_ID}>`, inline: true }
              )
              .setFooter({ text: 'Роль выдана автоматически при подтверждении правил' })
              .setTimestamp();
            await announceChannel.send({ embeds: [welcomeEmbed] }).catch(e => console.warn('Failed to send announce message:', e && e.message ? e.message : e));
          } else {
            console.warn('Missing permissions in announce channel, cannot post welcome:', missing.join(', '));
          }
        } else {
          console.warn('Announce channel not found:', ANNOUNCE_CHANNEL_ID);
        }
      } catch (e) {
        console.warn('Error while sending announce message:', e && e.message ? e.message : e);
      }
    } catch (err) {
      console.error('Failed to add role to member:', err && err.message ? err.message : err);
      try { await reaction.message.channel.send(`Не удалось выдать роль <@&${SUBSCRIBER_ROLE_ID}> — проверьте права бота и иерархию ролей.`); } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error('handleReactionAdd error', err);
  }
}

module.exports = { sendWelcomeMessage, handleReactionAdd };
