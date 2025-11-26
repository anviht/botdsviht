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
      { name: 'Получить роль', value: `Поставьте реакцию ✅ под этим сообщением, чтобы получить роль <@&${SUBSCRIBER_ROLE_ID}>.\nУберите реакцию ❌, чтобы удалить роль.` }
    )
    .setFooter({ text: 'Нажмите ✅ для роли, ❌ для удаления роли.' });

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

// Helper: send announcement to announce channel
async function sendAnnouncement(client, member, action) {
  try {
    const announceChannel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (!announceChannel) {
      console.warn('Announce channel not found:', ANNOUNCE_CHANNEL_ID);
      return;
    }

    const botMember = announceChannel.guild?.members?.cache?.get(client.user.id) || await announceChannel.guild?.members?.fetch(client.user.id).catch(() => null);
    const perms = announceChannel.permissionsFor ? announceChannel.permissionsFor(botMember || client.user) : null;
    const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
    const missing = perms ? needed.filter(p => !perms.has(p)) : needed;
    if (missing.length > 0) {
      console.warn('Missing permissions in announce channel:', missing.join(', '));
      return;
    }

    const color = action === 'add' ? 0x00AE86 : 0xE74C3C;
    const title = action === 'add' ? `🎉 Роль выдана` : `❌ Роль удалена`;
    const desc = action === 'add' 
      ? `Пользователь ${member.user.tag} получил роль <@&${SUBSCRIBER_ROLE_ID}>`
      : `Пользователь ${member.user.tag} удалил роль <@&${SUBSCRIBER_ROLE_ID}>`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .addFields(
        { name: 'Пользователь', value: `${member.user.tag} (<@${member.id}>)`, inline: false },
        { name: 'ID пользователя', value: `${member.id}`, inline: true },
        { name: 'Роль', value: `<@&${SUBSCRIBER_ROLE_ID}>`, inline: true }
      )
      .setTimestamp();

    await announceChannel.send({ embeds: [embed] }).catch(e => console.warn('Failed to send announce message:', e && e.message ? e.message : e));
  } catch (e) {
    console.warn('Error while sending announcement:', e && e.message ? e.message : e);
  }
}

// Handle reaction add (✅ adds role)
async function handleReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();
    
    // Check if this is in the welcome channel
    const rec = (db && db.get) ? db.get('welcome') : null;
    if (!rec) return;
    const onSavedMessage = (reaction.message.id === rec.messageId);
    const inWelcomeChannel = (String(reaction.message.channel.id) === String(rec.channelId));
    if (!onSavedMessage && !inWelcomeChannel) return;
    
    // Only handle ✅ emoji
    if (reaction.emoji.name !== '✅') return;
    
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      console.warn('Could not fetch member:', user.id);
      return;
    }

    const role = guild.roles.cache.get(SUBSCRIBER_ROLE_ID) || await guild.roles.fetch(SUBSCRIBER_ROLE_ID).catch(() => null);
    if (!role) {
      console.warn('Subscriber role not found:', SUBSCRIBER_ROLE_ID);
      try { await reaction.message.channel.send(`Роль <@&${SUBSCRIBER_ROLE_ID}> не найдена.`).catch(() => null); } catch (e) { /* ignore */ }
      return;
    }

    // Check role hierarchy
    const botMember = await guild.members.fetch(reaction.message.client.user.id).catch(() => null);
    const botHighestPos = botMember?.roles?.highest?.position ?? -1;
    const targetPos = role.position ?? -1;
    if (botHighestPos <= targetPos) {
      console.warn(`Bot role position (${botHighestPos}) <= target role position (${targetPos}), cannot assign`);
      try { await reaction.message.channel.send(`Роль бота ниже по иерархии. Поднимите роль бота выше роли <@&${SUBSCRIBER_ROLE_ID}>.`).catch(() => null); } catch (e) { /* ignore */ }
      return;
    }

    // Add role (no matter what roles they already have)
    try {
      await member.roles.add(role).catch(e => { throw e; });
      console.log(`[Role Add] ${user.tag} (${user.id}) - added role ${SUBSCRIBER_ROLE_ID}`);
      await sendAnnouncement(reaction.message.client, member, 'add').catch(() => null);
    } catch (err) {
      console.error(`[Role Add Failed] ${user.tag} - Error:`, err && err.message ? err.message : err);
      try { await reaction.message.channel.send(`Не удалось выдать роль <@&${SUBSCRIBER_ROLE_ID}>.`).catch(() => null); } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error('handleReactionAdd error', err);
  }
}

// Handle reaction remove (❌ removes role)
async function handleReactionRemove(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();

    // Check if this is in the welcome channel
    const rec = (db && db.get) ? db.get('welcome') : null;
    if (!rec) return;
    const onSavedMessage = (reaction.message.id === rec.messageId);
    const inWelcomeChannel = (String(reaction.message.channel.id) === String(rec.channelId));
    if (!onSavedMessage && !inWelcomeChannel) return;

    // Handle both ✅ and ❌ for removal
    if (reaction.emoji.name !== '✅') return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      console.warn('Could not fetch member:', user.id);
      return;
    }

    const role = guild.roles.cache.get(SUBSCRIBER_ROLE_ID) || await guild.roles.fetch(SUBSCRIBER_ROLE_ID).catch(() => null);
    if (!role) {
      console.warn('Subscriber role not found:', SUBSCRIBER_ROLE_ID);
      return;
    }

    // Remove role if they have it
    try {
      await member.roles.remove(role).catch(e => { throw e; });
      console.log(`[Role Remove] ${user.tag} (${user.id}) - removed role ${SUBSCRIBER_ROLE_ID}`);
      await sendAnnouncement(reaction.message.client, member, 'remove').catch(() => null);
    } catch (err) {
      console.error(`[Role Remove Failed] ${user.tag} - Error:`, err && err.message ? err.message : err);
    }
  } catch (err) {
    console.error('handleReactionRemove error', err);
  }
}

module.exports = { sendWelcomeMessage, handleReactionAdd, handleReactionRemove };
