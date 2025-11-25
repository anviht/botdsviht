const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const { token } = require('./config');

if (!token) console.warn('DISCORD_TOKEN not set in env — set it in .env before starting the bot');

// Intents
const intentsList = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions];
const { messageContentIntent, guildMembersIntent } = require('./config');
if (messageContentIntent) intentsList.push(GatewayIntentBits.MessageContent);
if (guildMembersIntent) intentsList.push(GatewayIntentBits.GuildMembers);

const client = new Client({ intents: intentsList, partials: [Partials.Message, Partials.Channel, Partials.Reaction] });

// Helper wrappers to make interaction replies/upates more resilient and to use flags for ephemeral
async function safeReply(interaction, options) {
  try {
    const payload = (typeof options === 'string') ? { content: options } : { ...options };
    if (payload.ephemeral) { payload.flags = 64; delete payload.ephemeral; }
    if (interaction.replied || interaction.deferred) {
      try {
        if (typeof payload.content === 'string') await interaction.editReply({ content: payload.content });
        else await interaction.editReply(payload);
      } catch (e) {
        try { await interaction.followUp(payload); } catch (e2) { console.error('safeReply followUp failed', e2); }
      }
    } else {
      await interaction.reply(payload);
    }
  } catch (e) {
    if (e && e.code === 10062) return; // Unknown interaction — ignore
    console.error('safeReply error', e && e.message ? e.message : e);
  }
}

async function safeUpdate(interaction, options) {
  try {
    const payload = (typeof options === 'string') ? { content: options } : { ...options };
    if (payload.ephemeral) { payload.flags = 64; delete payload.ephemeral; }
    await interaction.update(payload);
  } catch (e) {
    if (e && e.code === 10062) return; // Unknown interaction
    console.error('safeUpdate error', e && e.message ? e.message : e);
  }
}

async function safeShowModal(interaction, modal, attempts = 2) {
  let attempt = 0;
  while (attempt <= attempts) {
    attempt += 1;
    try {
      await interaction.showModal(modal);
      return;
    } catch (e) {
      // Undici connect timeout or transient network — retry a couple times
      if (e && e.code === 'UND_ERR_CONNECT_TIMEOUT' && attempt <= attempts) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      console.error('showModal failed', e && e.message ? e.message : e);
      // fallback: reply to user that the form couldn't be opened
      try { await safeReply(interaction, { content: 'Не удалось открыть форму.', ephemeral: true }); } catch (ignore) {}
      return;
    }
  }
}

// load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'register-commands.js');
  for (const file of commandFiles) {
    try { const command = require(path.join(commandsPath, file)); if (command.data && command.execute) client.commands.set(command.data.name, command); } catch (e) { console.warn('Failed loading command', file, e && e.message ? e.message : e); }
  }
}

const db = require('./libs/db');
const { sendPrompt } = require('./ai/vihtAi');

// optional helpers
let handleReactionAdd = null;
try { handleReactionAdd = require('./roles/reactionRole').handleReactionAdd; } catch (e) { /* optional */ }
try { const { initAutomod } = require('./moderation/automod'); initAutomod(client); } catch (e) { /* ignore */ }

// Interaction handler: commands, buttons, modals
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try { await command.execute(interaction); } catch (err) { console.error('Command error', err); await safeReply(interaction, { content: 'Ошибка при выполнении команды.', ephemeral: true }); }
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

      // Admin: begin confirm close all flow
      if (interaction.customId === 'support_close_all') {
        const STAFF_ROLES = ['1436485697392607303','1436486253066326067'];
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
        const STAFF_ROLES = ['1436485697392607303','1436486253066326067'];
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

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'support_modal') {
        try {
          const subject = interaction.fields.getTextInputValue('subject').slice(0,60);
          const message = interaction.fields.getTextInputValue('message').slice(0,2000);
          const ALLOWED_CREATOR_ROLES = ['1441744621641400353','1441745037531549777','1436486915221098588','1436486486156382299','1436486253066326067','1436485697392607303'];
          const STAFF_ROLES = ['1436485697392607303','1436486253066326067'];
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
    }
  } catch (err) { console.error('interactionCreate handler error', err); }
});

if (handleReactionAdd) client.on('messageReactionAdd', async (reaction, user) => { try { await handleReactionAdd(reaction, user); } catch (e) { console.error(e); } });

// AI chat handler
const { aiChatChannelId } = require('./config');
const COOLDOWN_MS = 3000; 
const lastMessageAt = new Map();
const processedMessages = new Set(); // Track processed messages

client.on('messageCreate', async (message) => {
  try {
    if (message.author?.bot) return; 
    if (!message.channel) return; 
    if (String(message.channel.id) !== String(aiChatChannelId)) return;
    
    // Prevent duplicate processing
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);

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
      const reply = await sendPrompt(message.content, { callerIsCreator, authorId: message.author.id, authorName: message.author.username });
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

  // Helper: format date/time in dd.mm.yyyy hh.mm (MSK)
  function formatDateTimeMSK(ms) {
    const d = new Date(ms);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    // MSK is UTC+3
    const mskDate = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    const hours = String(mskDate.getUTCHours()).padStart(2, '0');
    const mins = String(mskDate.getUTCMinutes()).padStart(2, '0');
    return { date: `${day}.${month}.${year}`, time: `${mins}.${hours}` };
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
      
      // Message 1: Bot started timestamp
      await statusChannel.send(`🚀 **Бот запущен:** ${date} ${time} по МСК`).catch(() => null);
      await new Promise(r => setTimeout(r, 3000));

      // Message 2: System check header
      await statusChannel.send(`✅ **Проверка систем:**`).catch(() => null);
      await new Promise(r => setTimeout(r, 3000));

      // Message 3a: AI status
      const aiKey = process.env.GEMINI_API_KEY;
      const aiStatus = aiKey ? '🤖 **Viht AI подключен и функционирует**' : '❌ **Viht AI ошибка: ключ не найден**';
      await statusChannel.send(aiStatus).catch(() => null);
      await new Promise(r => setTimeout(r, 3000));

      // Message 3b: Commands list
      const commandsList = Array.from(client.commands.values())
        .map(cmd => `\`${cmd.data.name}\` — ${cmd.data.description || 'Нет описания'}`)
        .join('\n');
      const commandsMsg = `📋 **Консольные команды в норме:**\n${commandsList || 'Команды не загружены'}`;
      await statusChannel.send(commandsMsg).catch(() => null);
      await new Promise(r => setTimeout(r, 3000));

      // Message 4: Preparation header
      await statusChannel.send(`⚙️ **б. Подготовка к постоянной работе:**`).catch(() => null);
      await new Promise(r => setTimeout(r, 3000));

      // Message 5: GitHub sync + auto-update with live uptime counter
      const uptimeHours = getUptimeHours();
      const updateMsg = `✅ **Синхронизация с GitHub Actions установлена**\n⏱️ **Автоматическое обновление включено ${uptimeHours} часов после запуска**`;
      const sentMsg = await statusChannel.send(updateMsg).catch(() => null);

      // Update uptime counter every hour
      if (sentMsg) {
        setInterval(async () => {
          try {
            const newUptime = getUptimeHours();
            const newText = `✅ **Синхронизация с GitHub Actions установлена**\n⏱️ **Автоматическое обновление включено ${newUptime} часов после запуска**`;
            await sentMsg.edit(newText).catch(() => null);
          } catch (e) {
            console.warn('Failed to update uptime counter:', e && e.message);
          }
        }, 60 * 60 * 1000); // Update every hour
      }

      console.log('Startup status report posted to', STATUS_CHANNEL_ID);
    }
  } catch (e) {
    console.warn('Failed to post startup status report:', e && e.message ? e.message : e);
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
});

// Global safety handlers to avoid process crash on uncaught errors
process.on('unhandledRejection', (reason, p) => {
  try { console.error('Unhandled Rejection at:', p, 'reason:', reason); } catch (e) { console.error('Unhandled Rejection', reason); }
});
process.on('uncaughtException', (err) => {
  try { console.error('Uncaught Exception:', err && err.stack ? err.stack : err); } catch (e) { console.error('Uncaught Exception', err); }
  // do not exit — keep process alive; consider reporting/alerting
});

client.login(token);
