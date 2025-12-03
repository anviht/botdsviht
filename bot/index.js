const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const { token } = require('./config');
const db = require('./libs/db');
const achievements = require('./libs/achievements');

// Ensure ffmpeg binary is available to downstream modules (ffmpeg-static provides a binary)
try {
  const ffpath = require('ffmpeg-static');
  if (ffpath) {
    process.env.FFMPEG_PATH = ffpath;
    process.env.FFMPEG = ffpath;
    // add containing dir to PATH so native spawn('ffmpeg') can find it
    const ffdir = path.dirname(ffpath);
    if (process.env.PATH && !process.env.PATH.includes(ffdir)) process.env.PATH = `${process.env.PATH}${path.delimiter}${ffdir}`;
    console.log('ffmpeg-static found and PATH updated');
  }
} catch (e) {
  console.warn('ffmpeg-static not available; ensure ffmpeg is installed in PATH for audio playback');
}
if (!token) {
  console.error('DISCORD_TOKEN not set in env — set it in .env before starting the bot. Exiting.');
  process.exit(1);
}
// Intents
// Include GuildVoiceStates so the bot can read which voice channel a member is in
const intentsList = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
];
const { messageContentIntent, guildMembersIntent } = require('./config');
if (messageContentIntent) intentsList.push(GatewayIntentBits.MessageContent);
if (guildMembersIntent) intentsList.push(GatewayIntentBits.GuildMembers);
const client = new Client({ intents: intentsList, partials: [Partials.Message, Partials.Channel, Partials.Reaction] });
// Global error handlers to capture runtime issues
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
// Use centralized interaction helpers
const { safeReply, safeUpdate, safeShowModal } = require('./libs/interactionUtils');
// load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'register-commands.js');
  for (const file of commandFiles) {
    try { const command = require(path.join(commandsPath, file)); if (command.data && command.execute) client.commands.set(command.data.name, command); } catch (e) { console.warn('Failed loading command', file, e && e.message ? e.message : e); }
  }
}
// db already required above
const { sendPrompt } = require('./ai/vihtAi');
const musicPlayer = require('./music/player2');
const { handleMusicButton, ensureMusicControlPanel } = require('./music-interface/musicHandler');
const { handleControlPanelButton } = require('./music-interface/controlPanelHandler');
const { handlePriceButton } = require('./price/priceHandler');
const { handleAiButton, createAiPanelEmbed, makeButtons: makeAiButtons } = require('./ai/aiHandler');
// optional helpers
let handleReactionAdd = null;
let handleReactionRemove = null;
try {
  const roleHandlers = require('./roles/reactionRole');
  handleReactionAdd = roleHandlers.handleReactionAdd;
  handleReactionRemove = roleHandlers.handleReactionRemove;
} catch (e) { /* optional */ }
try { const { initAutomod } = require('./moderation/automod'); initAutomod(client); } catch (e) { /* ignore */ }
// Interaction handler: commands, buttons, modals
client.on('interactionCreate', async (interaction) => {
  try {
    // attach helpers to interaction for commands to use if desired
    try { interaction.safeReply = (opts) => safeReply(interaction, opts); interaction.safeUpdate = (opts) => safeUpdate(interaction, opts); interaction.safeShowModal = (modal) => safeShowModal(interaction, modal); } catch (e) {}
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      
      // Log command to channel 1445119290444480684
      try {
        const logChannelId = '1445119290444480684';
        const logChannel = interaction.client.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased()) {
          const user = interaction.user;
          const commandName = interaction.commandName;
          await logChannel.send(`${user.toString()} использовал команду /${commandName}`);
        }
      } catch (logErr) {
        console.error('Failed to log command:', logErr && logErr.message ? logErr.message : logErr);
      }
      
      try {
        try { await achievements.checkFirstCommand(interaction.user.id, interaction); } catch (e) { /* ignore achievement errors */ }
        await command.execute(interaction);
      } catch (err) { console.error('Command error', err); await safeReply(interaction, { content: 'Ошибка при выполнении команды.', ephemeral: true }); }
      return;
    }
    if (interaction.isButton()) {
      // Show support creation modal
      if (interaction.customId === 'support_create') {
        const modal = new ModalBuilder().setCustomId('support_modal').setTitle('Создать обращение');
        const subj = new TextInputBuilder().setCustomId('subject').setLabel('Тема').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60);
        const msg = new TextInputBuilder().setCustomId('message').setLabel('Текст обращения').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000);
        modal.addComponents(new ActionRowBuilder().addComponents(subj), new ActionRowBuilder().addComponents(msg));
        try { await safeShowModal(interaction, modal); } catch (e) { console.error('showModal failed', e); await safeReply(interaction, { content: 'Не удалось открыть форму.', ephemeral: true }); }
        return;
      }
          // removed accidental command execution in button handler
      if (interaction.customId === 'support_close_all') {
        const cfgRoles = require('./config');
        const STAFF_ROLES = (cfgRoles.adminRoles && cfgRoles.adminRoles.length > 0) ? cfgRoles.adminRoles : ['1436485697392607303','1436486253066326067'];
        const member = interaction.member; const isStaff = member && member.roles && member.roles.cache && STAFF_ROLES.some(r => member.roles.cache.has(r));
        if (!isStaff) { await safeReply(interaction, { content: 'У вас нет прав для этой операции.', ephemeral: true }); return; }
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirm_close_all').setLabel('Да, закрыть все').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('cancel_close_all').setLabel('Отмена').setStyle(ButtonStyle.Secondary)
        );
        await safeReply(interaction, { content: 'Вы уверены? Это закроет все открытые обращения.', components: [confirmRow], ephemeral: true });
        return;
      }
      // confirm / cancel
      if (interaction.customId === 'confirm_close_all' || interaction.customId === 'cancel_close_all') {
        const cfgRoles = require('./config');
        const STAFF_ROLES = (cfgRoles.adminRoles && cfgRoles.adminRoles.length > 0) ? cfgRoles.adminRoles : ['1436485697392607303','1436486253066326067'];
        const member = interaction.member; const isStaff = member && member.roles && member.roles.cache && STAFF_ROLES.some(r => member.roles.cache.has(r));
        if (!isStaff) { await safeReply(interaction, { content: 'У вас нет прав для этой операции.', ephemeral: true }); return; }
        if (interaction.customId === 'cancel_close_all') { await safeUpdate(interaction, { content: 'Операция отменена.', components: [] }); return; }
        try { await interaction.deferReply({ flags: 64 }); } catch (e) { /* ignore */ }
        const tickets = db.get && db.get('tickets') ? db.get('tickets') : [];
        let closedCount = 0;
        for (const t of tickets) {
          if (!t || t.status === 'closed') continue;
          try {
            const ch = await client.channels.fetch(t.threadId).catch(() => null);
            if (ch) {
              try { if (typeof ch.send === 'function') await ch.send('Обращение закрыто администратором.'); } catch (e) {}
              try { if (!ch.archived) { if (typeof ch.setLocked === 'function') await ch.setLocked(true); await ch.setArchived(true); } } catch (e) {}
            }
          } catch (e) {}
          t.status = 'closed'; t.closedAt = new Date().toISOString(); closedCount += 1;
        }
        await db.set('tickets', tickets);
        await safeReply(interaction, { content: `Готово — закрыто обращений: ${closedCount}`, ephemeral: true });
      }
      // Price menu buttons
      if (interaction.customId && interaction.customId.startsWith('price_')) {
        try { await handlePriceButton(interaction); } catch (err) { console.error('Price button error', err); await safeReply(interaction, { content: 'Ошибка при обработке прайса.', ephemeral: true }); }
        return;
      }
      // AI buttons (ai_register, ai_close, ai_new, ai_delete)
      if (interaction.customId && interaction.customId.startsWith('ai_')) {
        try { await handleAiButton(interaction); } catch (err) { console.error('AI button error', err); await safeReply(interaction, { content: 'Ошибка при обработке кнопки ИИ.', ephemeral: true }); }
        return;
      }
      // Music/Radio buttons
        // Control panel buttons (cabinet, main menu, etc)
        if (interaction.customId.includes('cabinet') || interaction.customId.includes('main_menu') || interaction.customId === 'info_btn') {
          try { await handleControlPanelButton(interaction); } catch (err) { console.error('Control panel button error', err); await safeReply(interaction, { content: 'Ошибка при обработке кнопки.', ephemeral: true }); }
          return;
        }
      if (interaction.customId.startsWith('music_') || interaction.customId.startsWith('radio_')) {
        try { await handleMusicButton(interaction); } catch (err) { console.error('Music button error', err); await safeReply(interaction, { content: 'Ошибка при обработке кнопки музыки.', ephemeral: true }); }
        return;
      }
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'support_modal') {
        try {
          const subject = interaction.fields.getTextInputValue('subject').slice(0,60);
          const message = interaction.fields.getTextInputValue('message').slice(0,2000);
          const ALLOWED_CREATOR_ROLES = ['1441744621641400353','1441745037531549777','1436486915221098588','1436486486156382299','1436486253066326067','1436485697392607303'];
          const cfgRoles = require('./config');
          const STAFF_ROLES = (cfgRoles.adminRoles && cfgRoles.adminRoles.length > 0) ? cfgRoles.adminRoles : ['1436485697392607303','1436486253066326067'];
          const member = interaction.member;
          const allowed = member && member.roles && member.roles.cache && ALLOWED_CREATOR_ROLES.some(r => member.roles.cache.has(r));
          if (!allowed) return await safeReply(interaction, { content: 'У вас нет роли для создания обращения.', ephemeral: true });
          const channel = await interaction.client.channels.fetch('1442575929044897792').catch(() => null);
          if (!channel) return await safeReply(interaction, { content: 'Канал поддержки не найден.', ephemeral: true });
          const threadName = `ticket-${interaction.user.username}-${subject.replace(/[^a-zA-Z0-9-_]/g,'_').slice(0,40)}`;
          let thread = null;
          try { thread = await channel.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PrivateThread }); } catch (err) { console.error('thread create failed', err); thread = null; }
          let threadId = null; const ping = STAFF_ROLES.map(r => `<@&${r}>`).join(' ');
          if (thread) {
            threadId = thread.id;
            try { await thread.members.add(interaction.user.id).catch(() => null); for (const rid of STAFF_ROLES) { const members = interaction.guild.members.cache.filter(m => m.roles.cache.has(rid)); for (const m of members.values()) { try { await thread.members.add(m.id); } catch (e) {} } } } catch (e) {}
            await thread.send({ content: `${ping}\n**Тема:** ${subject}\n**От:** <@${interaction.user.id}>\n\n${message}` });
          } else { const sent = await channel.send({ content: `${ping}\n**Новая заявка**: ${subject}\n**От:** <@${interaction.user.id}>\n\n${message}` }); threadId = sent.id; }
          const all = db.get && db.get('tickets') ? db.get('tickets') : [];
          const ticket = { id: `t_${Date.now()}`, threadId, channelId: channel.id, creatorId: interaction.user.id, subject, message, status: 'open', createdAt: new Date().toISOString() };
          all.push(ticket); await db.set('tickets', all);
          return await safeReply(interaction, { content: `Обращение создано. ${thread ? `Тред: <#${thread.id}>` : 'Сделано в канале.'}`, ephemeral: true });
        } catch (e) { console.error('modal submit error', e); return await safeReply(interaction, { content: 'Ошибка при создании обращения.', ephemeral: true }); }
      }
      // Music modal: play now
      if (interaction.customId === 'music_modal') {
        try {
          const query = interaction.fields.getTextInputValue('music_query').slice(0, 400);
          const guild = interaction.guild;
          const member = interaction.member || (guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);
          const voiceChannel = member && member.voice ? member.voice.channel : null;
          if (!voiceChannel) {
            await safeReply(interaction, { content: 'Вы не в голосовом канале.', ephemeral: true });
            return;
          }
          // Let musicPlayer.playNow handle all updates via updateControlMessageWithError
          await safeReply(interaction, { content: '🔎 Ищу и начинаю воспроизведение...', ephemeral: true });
          await musicPlayer.playNow(guild, voiceChannel, query, interaction.channel, interaction.user.id).catch(async (e) => { console.error('playNow error', e); });
          return;
        } catch (e) { console.error('music_modal submit error', e); return await safeReply(interaction, { content: 'Ошибка при обработке формы музыки.', ephemeral: true }); }
      }
      // Music modal: add to queue
      if (interaction.customId === 'music_modal_queue') {
        try {
          const query = interaction.fields.getTextInputValue('music_query').slice(0, 400);
          const guild = interaction.guild;
          const ok = await musicPlayer.addToQueue(guild, query);
          if (ok) {
            await safeReply(interaction, { content: 'Добавлено в очередь ✅', ephemeral: true });
          } else {
            await safeReply(interaction, { content: 'Не удалось добавить в очередь.', ephemeral: true });
          }
          return;
        } catch (e) { console.error('music_modal_queue submit error', e); return await safeReply(interaction, { content: 'Ошибка при обработке формы музыки.', ephemeral: true }); }
      }
      // Custom music search modal: find and play
      if (interaction.customId === 'music_search_modal') {
        try {
          const songName = interaction.fields.getTextInputValue('song_name').slice(0, 200);
          const guild = interaction.guild;
          const member = interaction.member || (guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);
          const voiceChannel = member && member.voice ? member.voice.channel : null;
          if (!voiceChannel) {
            await safeReply(interaction, { content: '❌ Вы не в голосовом канале.', ephemeral: true });
            return;
          }
          // Let musicPlayer.playNow handle all updates via updateControlMessageWithError
          await safeReply(interaction, { content: `🔎 Ищу песню "${songName}"...`, ephemeral: true });
          await musicPlayer.playNow(guild, voiceChannel, songName, interaction.channel, interaction.user.id).catch(async (e) => { console.error('custom music search error', e); });
          return;
        } catch (e) { console.error('music_search_modal submit error', e); return await safeReply(interaction, { content: 'Ошибка при поиске песни.', ephemeral: true }); }
      }
      // Custom music queue modal: add to queue
      if (interaction.customId === 'music_queue_modal') {
        try {
          const songName = interaction.fields.getTextInputValue('song_name_queue').slice(0, 200);
          const guild = interaction.guild;
          const ok = await musicPlayer.addToQueue(guild, songName);
          if (ok) {
            await safeReply(interaction, { content: `✅ "${songName}" добавлена в очередь`, ephemeral: true });
          } else {
            await safeReply(interaction, { content: 'Не удалось найти и добавить песню.', ephemeral: true });
          }
          return;
        } catch (e) { console.error('music_queue_modal submit error', e); return await safeReply(interaction, { content: 'Ошибка при добавлении в очередь.', ephemeral: true }); }
      }
    }
  } catch (err) { console.error('interactionCreate handler error', err); }
});

// Onboarding: send DM to new members unless they opted out
client.on('guildMemberAdd', async (member) => {
  try {
    await db.ensureReady();
    const prefs = db.get('prefs') || {};
    const enabled = (prefs.onboarding && prefs.onboarding[member.id] !== false);
    if (!enabled) return;
    const welcome = `Привет, ${member.user.username}! Добро пожаловать на сервер. Если хотите, используйте команду /onboarding optout чтобы отключить приветственные сообщения.`;
    await member.send(welcome).catch(() => null);
  } catch (e) { console.warn('onboarding send failed', e && e.message); }
});

// Schedule persistent reminders stored in DB
(async function scheduleReminders() {
  try {
    await db.ensureReady();
    const reminders = db.get('reminders') || [];
    const now = Date.now();
    for (const r of reminders) {
      const delay = Math.max(0, (r.when || 0) - now);
      setTimeout(async () => {
        try { const ch = await client.channels.fetch(r.channelId).catch(()=>null); if (ch) await ch.send(`<@${r.userId}> Напоминание: ${r.text}`); } catch (e) {}
        // remove reminder from db
        const cur = db.get('reminders') || [];
        await db.set('reminders', cur.filter(x => x.id !== r.id));
      }, delay);
    }
  } catch (e) { console.warn('scheduleReminders failed', e && e.message); }
})();

// Load user language preferences into client for quick access
(async function loadUserLangs() {
  try {
    await db.ensureReady();
    const ul = db.get('userLangs') || {};
    client.userLangs = new Map(Object.entries(ul));
  } catch (e) { client.userLangs = new Map(); }
})();
if (handleReactionAdd) client.on('messageReactionAdd', async (reaction, user) => { try { await handleReactionAdd(reaction, user); } catch (e) { console.error('messageReactionAdd handler:', e); } });
if (handleReactionRemove) client.on('messageReactionRemove', async (reaction, user) => { try { await handleReactionRemove(reaction, user); } catch (e) { console.error('messageReactionRemove handler:', e); } });
// AI chat handler
const { aiChatChannelId } = require('./config');
const COOLDOWN_MS = 3000;
const lastMessageAt = new Map();
const processedMessages = new Set(); // Track processed messages
client.on('messageCreate', async (message) => {
  try {
    if (message.author?.bot) return;
    if (!message.channel) return;
    const ch = message.channel;
    const isThread = !!ch?.isThread && ch.isThread();
    const isAiMain = String(ch.id) === String(aiChatChannelId);
    const isAiThread = isThread && String(ch.parentId) === String(aiChatChannelId);
    if (!isAiMain && !isAiThread) return;
   
    // Prevent duplicate processing
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    // Quick 'whoami' handler: respond with user info when user asks "кто я" or "я кто",
    // but ignore cases containing "а я" (per request).
    try {
      const whoamiRegex = /^\s*(?:кто\s+я|я\s+кто)\b/i;
      const excludeRegex = /\bа\s+я\b/i;
      const text = (message.content || '').trim();
      if (whoamiRegex.test(text) && !excludeRegex.test(text)) {
        // Ensure we have member info
        let member = message.member;
        if ((!member || !member.roles) && message.guild) {
          member = await message.guild.members.fetch(message.author.id).catch(() => null);
        }
        const user = message.author;
        const created = user.createdAt ? new Date(user.createdAt) : null;
        const createdStr = created ? `${String(created.getDate()).padStart(2,'0')}.${String(created.getMonth()+1).padStart(2,'0')}.${created.getFullYear()} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}` : '—';
        let rolesList = 'Нет ролей';
        if (member && member.roles && member.roles.cache) {
          const filtered = member.roles.cache.filter(r => r.id !== message.guild.id);
          if (filtered.size > 0) rolesList = filtered.map(r => `${r.name} (id: ${r.id})`).join(', ');
        }
        const reply = `🧾 **Информация о пользователе**
**Вы:** ${user.username}
**Ваш тег:** ${user.tag}
**Ваш id:** ${user.id}
**Зарегистрирован:** ${createdStr}
**Роли:** ${rolesList} \n
Если нужна подробная информация о ролях или правах — напишите, и я подскажу. 😊`;
        try { await message.reply({ content: reply, allowedMentions: { parse: [] } }); } catch (e) { try { await message.channel.send(reply).catch(() => null); } catch (e2) {} }
        return;
      }
    } catch (e) { console.warn('whoami handler failed', e && e.message ? e.message : e); }
    // Ensure DB ready for greeted users tracking
    try { if (db && db.ensureReady) await db.ensureReady(); } catch (e) { console.warn('DB ensureReady failed:', e && e.message); }
    // Auto-greeting removed: the bot will not proactively greet or offer help.
    // This prevents unsolicited template replies. The bot will respond only to explicit messages.
   
    const now = Date.now();
    const last = lastMessageAt.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    lastMessageAt.set(message.author.id, now);
   
    try {
      const cfg = require('./config');
      if (cfg.useMockAi) {
        const q = (message.content || '').trim();
        let quick = 'Принято. Сейчас не могу использовать внешний AI, но постараюсь помочь — уточните запрос.';
        if (/\b(кто\s+такой\s+viht|viht|вихт)\b/i.test(q)) quick = 'Viht — команда, создающая быстрые и надёжные VPN‑решения.';
        else if (/\b(андрей|andrey|кто\s+такой\s+андрей)\b/i.test(q)) quick = 'Андрей Вихт — основатель проекта Viht.';
        else if (/\b(сандра|sandra)\b/i.test(q)) quick = 'Сандра — спутник и поддержка Андрея.';
        else if (/\b(ной|noya|ной\s*бой)\b/i.test(q)) quick = 'Ной Бой — друг и товарищ команды.';
        await message.reply(quick);
        return;
      }
      try { message.channel.sendTyping(); } catch (e) {}
      const controlRoleId = '1436485697392607303';
      const callerIsCreator = message.member && message.member.roles && message.member.roles.cache && message.member.roles.cache.has(controlRoleId);
      // If this message is in a private AI thread, find the aiChats record and use composite authorId (userId:chatId)
      let authorKey = message.author.id;
      try { await db.ensureReady(); } catch (e) {}
      if (isAiThread) {
        const aiChats = db.get('aiChats') || {};
        const rec = Object.values(aiChats).find(r => r && r.threadId === ch.id);
        if (rec && rec.chatId) {
          authorKey = `${message.author.id}:${rec.chatId}`;
        }
      }
      const reply = await sendPrompt(message.content, { callerIsCreator, authorId: authorKey, authorName: message.author.username });
      await db.incrementAi();
      const out = String(reply || '').trim();
      if (out.length > 0) {
        for (let i = 0; i < out.length; i += 1200) {
          const chunk = out.slice(i, i + 1200);
          await message.reply(chunk);
        }
      }
    } catch (err) { console.error('AI error:', err); await message.reply('Ошибка: AI недоступен.'); }
  } catch (err) { console.error('messageCreate handler error', err); }
});
// Ready: post rules and support panel (once)
// Track bot startup time for uptime counter
const botStartTime = Date.now();
client.once('ready', async () => {
  console.log(`Ready as ${client.user.tag}`);
  console.log('Config flags:', { messageContentIntent, guildMembersIntent });
  // Ensure DB is fully initialized
  await db.ensureReady();
  console.log('DB ready, proceeding with startup status report');
  // Auto-register slash commands if enabled via env
  try {
    const autoReg = process.env.AUTO_REGISTER_COMMANDS === 'true' || process.env.AUTO_REGISTER_COMMANDS === '1';
    if (autoReg) {
      try {
        const registerCommands = require('./commands/register-commands');
        if (typeof registerCommands === 'function') {
          await registerCommands();
          console.log('Auto command registration completed.');
        } else {
          console.warn('register-commands did not export a function; skipping auto registration');
        }
      } catch (err) {
        console.warn('Auto command registration failed:', err && err.message ? err.message : err);
      }
    }
  } catch (e) { /* ignore */ }
  // Helper: format date/time in dd.mm.yyyy hh.mm (MSK)
  function formatDateTimeMSK(ms) {
    const msk = new Date(ms + 3 * 60 * 60 * 1000);
    const day = String(msk.getUTCDate()).padStart(2, '0');
    const month = String(msk.getUTCMonth() + 1).padStart(2, '0');
    const year = msk.getUTCFullYear();
    const hours = String(msk.getUTCHours()).padStart(2, '0');
    const mins = String(msk.getUTCMinutes()).padStart(2, '0');
    return { date: `${day}.${month}.${year}`, time: `${hours}:${mins}` };
  }
  // Helper: get uptime in hours
  function getUptimeHours() {
    return Math.floor((Date.now() - botStartTime) / (1000 * 60 * 60));
  }
  // Send startup report to status channel
  const STATUS_CHANNEL_ID = '1441896031531827202';
  try {
    const statusChannel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
    if (statusChannel) {
      const { date, time } = formatDateTimeMSK(botStartTime);
      let version = 'unknown';
      try { version = (fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf-8') || '').trim() || version; } catch (e) {}
      let gitSha = 'unknown';
      try { const { execSync } = require('child_process'); gitSha = String(execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), timeout: 2000 })).trim(); } catch (e) {}
      const msg = `✅ **Бот запущен**\n🕒 Время: ${time}\n📅 Дата: ${date} по МСК\n🔖 Версия: ${version}\n🔁 Commit: ${gitSha}`;
      await statusChannel.send(msg).catch(() => null);
      console.log('Startup status report posted to', STATUS_CHANNEL_ID, 'version', version, 'commit', gitSha);
    }
  } catch (e) {
    console.warn('Failed to post startup status report:', e && e.message ? e.message : e);
  }
  // Startup reconciliation: restore active mutes and reschedule unmute timers
  try {
    const MUTE_ROLE_ID = '1445152678706679939';
    const mutes = db.get('mutes') || {};
    const now = Date.now();
    for (const [userId, entry] of Object.entries(mutes)) {
      try {
        const guild = client.guilds.cache.get(entry.guildId);
        if (!guild) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        // Ensure mute role exists and is present
        const mutedRole = guild.roles.cache.get(MUTE_ROLE_ID);
        if (!mutedRole) {
          console.warn(`Mute role ${MUTE_ROLE_ID} not found on guild ${guild.id}, skipping user ${userId}`);
          continue;
        }

        // If mute role is not present, add it
        if (!member.roles.cache.has(MUTE_ROLE_ID)) {
          try { await member.roles.add(MUTE_ROLE_ID); } catch (e) {
            console.warn(`Failed to add mute role to ${userId}:`, e.message);
          }
        }

        // Calculate remaining time and schedule unmute if needed
        if (entry && entry.unmuteTime) {
          const unmuteAt = new Date(entry.unmuteTime).getTime();
          const ms = Math.max(0, unmuteAt - now);

          if (ms <= 0) {
            // Mute has already expired, unmute immediately
            try {
              if (member.roles.cache.has(MUTE_ROLE_ID)) {
                await member.roles.remove(MUTE_ROLE_ID);
              }
              // Restore removed roles
              if (entry.removedRoles && entry.removedRoles.length > 0) {
                const toRestore = entry.removedRoles.filter(id => guild.roles.cache.has(id));
                if (toRestore.length > 0) {
                  await member.roles.add(toRestore);
                }
              }
              const current = db.get('mutes') || {};
              delete current[userId];
              await db.set('mutes', current);
            } catch (e) {
              console.warn(`Failed to unmute expired user ${userId}:`, e.message);
            }
          } else {
            // Schedule unmute for later
            setTimeout(async () => {
              try {
                const g = await client.guilds.fetch(entry.guildId).catch(() => null);
                if (!g) return;
                const m = await g.members.fetch(userId).catch(() => null);
                if (!m) return;

                // Remove mute role
                if (m.roles.cache.has(MUTE_ROLE_ID)) {
                  try { await m.roles.remove(MUTE_ROLE_ID); } catch (e) {
                    console.warn(`Failed to remove mute role from ${userId}:`, e.message);
                  }
                }

                // Restore removed roles
                if (entry.removedRoles && entry.removedRoles.length > 0) {
                  const toRestore = entry.removedRoles.filter(id => g.roles.cache.has(id));
                  if (toRestore.length > 0) {
                    try { await m.roles.add(toRestore); } catch (e) {
                      console.warn(`Failed to restore roles to ${userId}:`, e.message);
                    }
                  }
                }

                // Remove from mutes DB
                const current = db.get('mutes') || {};
                delete current[userId];
                await db.set('mutes', current);

                console.log(`User ${userId} automatically unmuted after timeout`);
              } catch (e) {
                console.error('Unmute timer error:', e.message);
              }
            }, ms);
            console.log(`Scheduled unmute for user ${userId} in ${Math.round(ms / 1000)}s`);
          }
        }
      } catch (e) {
        console.warn(`Error reconciling mute for user ${userId}:`, e.message);
      }
    }
    console.log('Mute reconciliation completed');
  } catch (e) {
    console.warn('Failed mute reconciliation:', e && e.message ? e.message : e);
  }

  // RULES POSTING DISABLED - commented out to prevent duplicate postings
  /*
  try {
    const RULES_CHANNEL_ID = '1436487842334507058';
    const rulesRec = db.get('rulesPosted');
    console.log('Rules check:', { rulesRec });
   
    if (!rulesRec) {
      const channel = await client.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
      if (channel) {
        const RULES_TEXT = `📜** Устав Сообщества Viht AI & VPN**\n\n` + "`*Добро пожаловать в наше официальное сообщество! Мы ценим открытость, скорость и взаимное уважение. Соблюдение этих простых правил делает сервер полезным для всех.*`" + `\n\n`;
        try { if (RULES_TEXT.length <= 1900) await channel.send(RULES_TEXT); else { for (let i=0;i<RULES_TEXT.length;i+=1900) await channel.send(RULES_TEXT.slice(i,i+1900)); } } catch (e) { console.warn('Failed sending rules chunk', e && e.message ? e.message : e); }
        if (db && db.set) await db.set('rulesPosted', { channelId: RULES_CHANNEL_ID, postedAt: Date.now() });
      } else {
        console.warn('Rules channel not found:', RULES_CHANNEL_ID);
      }
    }
  } catch (e) { console.warn('Failed to post rules on ready:', e && e.message ? e.message : e); }
  */
  // Refresh welcome message on every startup (delete old, post new)
  try {
    const { sendWelcomeMessage } = require('./roles/reactionRole');
    const WELCOME_CHANNEL_ID = '1436487788760535143';
    const welcomeChannel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
   
    if (welcomeChannel) {
      const welcomeRec = db.get('welcome');
      // If there is an existing saved message, try to edit it instead of deleting
      if (welcomeRec && welcomeRec.messageId) {
        try {
          const oldMsg = await welcomeChannel.messages.fetch(welcomeRec.messageId).catch(() => null);
          if (oldMsg) {
            // Build the same embed as in sendWelcomeMessage and edit existing message
            const { EmbedBuilder } = require('discord.js');
            const SUBSCRIBER_ROLE_ID = process.env.SUBSCRIBER_ROLE_ID || '1441744621641400353';
            const embed = new EmbedBuilder()
              .setTitle('Добро пожаловать на сервер Viht VPN')
              .setColor(0x1abc9c)
              .setDescription('Добро пожаловать! Здесь собирается сообщество вокруг экосистемы Viht: решения по VPN и защите данных, интеграции с AI, разработка сайтов и ботов. Мы ценим конфиденциальность и надёжность.')
              .addFields(
                { name: 'О канале', value: 'Здесь вы найдёте обсуждения по VPN, безопасности, интеграциям AI и помощи при создании сайтов и ботов. Мы ценим конфиденциальность и надёжность.' },
                { name: 'Получить роль', value: `Поставьте реакцию ✅ под этим сообщением, чтобы получить роль <@&${SUBSCRIBER_ROLE_ID}>.\nУберите реакцию ❌, чтобы удалить роль.` }
              )
              .setFooter({ text: 'Нажмите ✅ для роли, ❌ для удаления роли.' });
            await oldMsg.edit({ embeds: [embed] }).catch(() => null);
            try { await oldMsg.react('✅').catch(() => null); } catch (e) {}
            console.log('Updated existing welcome message:', welcomeRec.messageId);
          } else {
            // If message doesn't exist, post a fresh one via helper
            await sendWelcomeMessage(client, WELCOME_CHANNEL_ID);
            console.log('Posted new welcome message in', WELCOME_CHANNEL_ID);
          }
        } catch (e) {
          // fallback to helper if editing fails
          await sendWelcomeMessage(client, WELCOME_CHANNEL_ID).catch(() => null);
          console.log('Refreshed welcome message in', WELCOME_CHANNEL_ID);
        }
      } else {
        // No saved message — post new welcome message
        await sendWelcomeMessage(client, WELCOME_CHANNEL_ID);
        console.log('Posted welcome message in', WELCOME_CHANNEL_ID);
      }
    } else {
      console.warn('Welcome channel not found:', WELCOME_CHANNEL_ID);
    }
  } catch (e) { console.warn('Failed to refresh welcome message:', e && e.message ? e.message : e); }
  // Post or update support panel
  try {
    const SUPPORT_CHANNEL_ID = '1442575929044897792';
    const panelRec = db.get('supportPanelPosted');
    console.log('Support panel check:', { panelRec });
    const supportChannel = await client.channels.fetch(SUPPORT_CHANNEL_ID).catch(() => null);
    if (!supportChannel) return console.warn('Support channel not found:', SUPPORT_CHANNEL_ID);
    const embed = new EmbedBuilder().setTitle('🛠️ Служба поддержки Viht').setColor(0x0066cc).setDescription('Нажмите кнопку ниже, чтобы создать новое обращение в службу поддержки. Пожалуйста, указывайте тему и подробности — это поможет нам быстрее решить вашу проблему.');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('support_create').setLabel('Создать обращение').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('support_close_all').setLabel('Закрыть все обращения (админы)').setStyle(ButtonStyle.Danger));
    if (!panelRec) {
      const msg = await supportChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (msg && db && db.set) await db.set('supportPanelPosted', { channelId: SUPPORT_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() });
      console.log('Posted support panel to', SUPPORT_CHANNEL_ID);
    } else {
      const existing = await supportChannel.messages.fetch(panelRec.messageId).catch(() => null);
      if (existing) { await existing.edit({ embeds: [embed], components: [row] }).catch(() => null); console.log('Updated existing support panel message with admin button'); }
      else { const msg = await supportChannel.send({ embeds: [embed], components: [row] }).catch(() => null); if (msg && db && db.set) await db.set('supportPanelPosted', { channelId: SUPPORT_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() }); console.log('Reposted support panel to', SUPPORT_CHANNEL_ID); }
    }
  } catch (e) { console.warn('Failed to post support panel on ready:', e && e.message ? e.message : e); }
  // Post AI panel in configured AI channel (ensure it exists and is editable)
  try {
    const AI_PANEL_KEY = 'aiPanelPosted';
    const aiChannelId = aiChatChannelId;
    async function ensureAiPanel() {
      try {
        if (!aiChannelId) return console.warn('aiChatChannelId not configured');
        const aiChannel = await client.channels.fetch(aiChannelId).catch(() => null);
        if (!aiChannel) return console.warn('AI panel channel not found:', aiChannelId);
        const embed = createAiPanelEmbed();
        const row = makeAiButtons();
        const rec = db.get(AI_PANEL_KEY);
        if (rec && rec.channelId === aiChannelId && rec.messageId) {
          const existing = await aiChannel.messages.fetch(rec.messageId).catch(() => null);
          if (existing) {
            await existing.edit({ embeds: [embed], components: row }).catch(() => null);
            console.log('Updated existing AI panel message');
            return;
          }
        }
        const msg = await aiChannel.send({ embeds: [embed], components: row }).catch(() => null);
        if (msg && db && db.set) await db.set(AI_PANEL_KEY, { channelId: aiChannelId, messageId: msg.id, postedAt: Date.now() });
        console.log('Posted AI panel to', aiChannelId);
      } catch (err) { console.warn('ensureAiPanel error', err && err.message ? err.message : err); }
    }
    await ensureAiPanel();
    setInterval(async () => { try { await ensureAiPanel(); } catch (e) { } }, 5 * 60 * 1000);
  } catch (e) { console.warn('Failed to ensure AI panel on ready:', e && e.message ? e.message : e); }
  // Post bot management panel with music — robust ensure/edit/post helper
  try {
    const CONTROL_PANEL_CHANNEL_ID = '1443194196172476636';
    const panelCheckKey = 'controlPanelPosted';
    const { createMainControlPanelEmbed, getMainControlRow } = require('./music-interface/controlPanelEmbeds');

    async function ensureControlPanel() {
      try {
        const controlChannel = await client.channels.fetch(CONTROL_PANEL_CHANNEL_ID).catch(() => null);
        if (!controlChannel) { console.warn('Control panel channel not found:', CONTROL_PANEL_CHANNEL_ID); return; }

        const mainEmbed = createMainControlPanelEmbed();
        const controlRow = getMainControlRow();

        const rec = db.get(panelCheckKey);
        if (rec && rec.channelId === CONTROL_PANEL_CHANNEL_ID && rec.messageId) {
          const existing = await controlChannel.messages.fetch(rec.messageId).catch(() => null);
          if (existing) {
            await existing.edit({ embeds: [mainEmbed], components: [controlRow] }).catch(() => null);
            console.log('Updated existing control panel message');
            try {
              const musicKey = `musicControl_${controlChannel.guild.id}`;
              const mrec = db.get(musicKey);
              if (!mrec || !mrec.messageId) await db.set(musicKey, { channelId: CONTROL_PANEL_CHANNEL_ID, messageId: existing.id });
            } catch (e) { /* ignore */ }
            return;
          }
        }

        // Post a fresh message (either no record or existing was deleted)
        const msg = await controlChannel.send({ embeds: [mainEmbed], components: [controlRow] }).catch(() => null);
        if (msg && db && db.set) {
          await db.set(panelCheckKey, { channelId: CONTROL_PANEL_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() });
          try { await db.set(`musicControl_${controlChannel.guild.id}`, { channelId: CONTROL_PANEL_CHANNEL_ID, messageId: msg.id }); } catch (e) { /* ignore */ }
        }
        console.log('Posted control panel to', CONTROL_PANEL_CHANNEL_ID);
      } catch (err) { console.warn('ensureControlPanel error', err && err.message ? err.message : err); }
    }

    // Run immediately and schedule periodic checks to keep the panel present/updated
    await ensureControlPanel();
    setInterval(async () => { try { await ensureControlPanel(); } catch (e) { /* ignore periodic */ } }, 5 * 60 * 1000);
  } catch (e) { console.warn('Failed to ensure control panel on ready:', e && e.message ? e.message : e); }
  // After control panel: post price / information panel
  try {
    const PRICE_CHANNEL_ID = '1443194062269321357';
    const priceKey = 'pricePanelPosted';
    const priceChannel = await client.channels.fetch(PRICE_CHANNEL_ID).catch(() => null);
    if (!priceChannel) {
      console.warn('Price channel not found:', PRICE_CHANNEL_ID);
    } else {
      const { createPriceMainEmbed, getMainRow } = require('./price/priceEmbeds');
      const rec = db.get(priceKey);
      const mainEmbed = createPriceMainEmbed();
      const mainRow = getMainRow();
      if (!rec) {
        const msg = await priceChannel.send({ embeds: [mainEmbed], components: [mainRow] }).catch(() => null);
        if (msg && db && db.set) await db.set(priceKey, { channelId: PRICE_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() });
        console.log('Posted price panel to', PRICE_CHANNEL_ID);
      } else {
        const existing = await priceChannel.messages.fetch(rec.messageId).catch(() => null);
        if (existing) { await existing.edit({ embeds: [mainEmbed], components: [mainRow] }).catch(() => null); console.log('Updated existing price panel message'); }
        else { const msg = await priceChannel.send({ embeds: [mainEmbed], components: [mainRow] }).catch(() => null); if (msg && db && db.set) await db.set(priceKey, { channelId: PRICE_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() }); console.log('Reposted price panel to', PRICE_CHANNEL_ID); }
      }
    }
  } catch (e) { console.warn('Failed to post price panel on ready:', e && e.message ? e.message : e); }
});
// Global safety handlers to avoid process crash on uncaught errors
process.on('unhandledRejection', (reason, p) => {
  try { console.error('Unhandled Rejection at:', p, 'reason:', reason); } catch (e) { console.error('Unhandled Rejection', reason); }
});
process.on('uncaughtException', (err) => {
  try { console.error('Uncaught Exception:', err && err.stack ? err.stack : err); } catch (e) { console.error('Uncaught Exception', err); }
  // do not exit — keep process alive; consider reporting/alerting
});
// Graceful shutdown handlers
async function gracefulShutdown(signal) {
  try {
    console.log(`[Shutdown] Received ${signal}, logging out client and exiting`);
    if (client && client.user) {
      try { await client.destroy(); } catch (e) { console.warn('Error destroying client', e && e.message); }
    }
    // allow other cleanup (DB flush) if needed
    process.exit(0);
  } catch (e) {
    console.error('Error during gracefulShutdown', e && e.message ? e.message : e);
    process.exit(1);
  }
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Global error handlers to prevent bot crash
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error && error.message ? error.message : error);
  if (error && error.stack) console.error(error.stack);
  // Don't exit - let bot continue running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason && reason.message ? reason.message : reason);
  // Don't exit - let bot continue running
});

client.login(token);
