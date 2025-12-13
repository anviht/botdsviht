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
const { handleMusicButton, updateControlMessageWithError } = require('./music-interface/musicHandler');
const { handleControlPanelButton } = require('./music-interface/controlPanelHandler');
const { handlePriceButton } = require('./price/priceHandler');
const { handleAiButton, createAiPanelEmbed, makeButtons: makeAiButtons } = require('./ai/aiHandler');
const { ensureMenuPanel, handleMenuButton } = require('./menus/menuHandler');
const { postPlayerMessage, handlePlayerPanelButton, handlePlayerPanelModal } = require('./music-interface/playerPanel');
const { postPostManagerPanel, handlePostManagerButton, handlePostManagerSelect, handlePostManagerModal } = require('./post-manager/postManager');
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
// Channel IDs for themed logs (defined early so handlers can use them)
const COMMAND_LOG_CHANNEL = '1446801265219604530';     // Логи команд
const VOICE_LOG_CHANNEL = '1446801072344662149';       // Логи голоса: вход/выход/кик
const SUPPORT_CHANNEL_ID = '1446801072344662149';      // Канал поддержки
const STATUS_CHANNEL_ID = '1445848232965181500';       // Статус плеера
const NICK_CHANGE_LOG_CHANNEL = '1446800866630963233'; // Логи изменения ников
const MODERATION_LOG_CHANNEL = '1446798710511243354';  // Логи модерации (бан, вар, мут)
const MESSAGE_EDIT_LOG_CHANNEL = '1446796850471505973';// Логи редактирования сообщений
const BADWORD_LOG_CHANNEL = '1446796960697679953';     // Логи матерных слов
const MUSIC_LOG_CHANNEL = '1445848232965181500';       // Логи музыки

client.on('interactionCreate', async (interaction) => {
  try {
    // attach helpers to interaction for commands to use if desired
    try { interaction.safeReply = (opts) => safeReply(interaction, opts); interaction.safeUpdate = (opts) => safeUpdate(interaction, opts); interaction.safeShowModal = (modal) => safeShowModal(interaction, modal); } catch (e) {}
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      
      // Log command to configured command log channel
      try {
        const logChannelId = COMMAND_LOG_CHANNEL;
        const logChannel = interaction.client.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased && logChannel.isTextBased()) {
          const user = interaction.user;
          const commandName = interaction.commandName;
          await logChannel.send(`${user.toString()} использовал команду /${commandName}`).catch(() => null);
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
      // Infopol buttons (очистка данных пользователя)
      if (interaction.customId && interaction.customId.startsWith('infopol_clear_')) {
        try {
          const userId = interaction.customId.split('_')[2];
          const config = require('./config');
          const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          const isAdmin = member && member.roles && config.adminRoles && config.adminRoles.some(rid => member.roles.cache.has(rid));
          if (!isAdmin) return await safeReply(interaction, { content: 'У вас нет прав для этой операции.', ephemeral: true });

          const userViolations = db.get('userViolations') || {};
          const userMutes = db.get('userMutes') || {};
          const userBans = db.get('userBans') || {};

          delete userViolations[userId];
          delete userMutes[userId];
          delete userBans[userId];

          await db.set('userViolations', userViolations);
          await db.set('userMutes', userMutes);
          await db.set('userBans', userBans);

          await safeReply(interaction, { content: `✅ Данные пользователя <@${userId}> очищены.`, ephemeral: true });
        } catch (err) {
          console.error('Infopol clear button error', err);
          await safeReply(interaction, { content: 'Ошибка при очистке данных.', ephemeral: true });
        }
        return;
      }
      // Price menu buttons
      if (interaction.customId && interaction.customId.startsWith('price_')) {
        try { await handlePriceButton(interaction); } catch (err) { console.error('Price button error', err); await safeReply(interaction, { content: 'Ошибка при обработке прайса.', ephemeral: true }); }
        return;
      }
      // AI buttons (ai_register, ai_new, ai_list, ai_action_*)
      if (interaction.customId && interaction.customId.startsWith('ai_')) {
        // Handle AI action buttons (goto, close)
        if (interaction.customId.startsWith('ai_action_goto_') || interaction.customId.startsWith('ai_action_close_')) {
          try {
            await db.ensureReady();
            const userId = String(interaction.user.id);
            const allChats = db.get('aiChats') || {};
            const userChat = allChats[userId];
            
            if (!userChat) {
              await safeReply(interaction, { content: '❌ Ветка не найдена.', ephemeral: true });
              return;
            }

            if (interaction.customId.startsWith('ai_action_goto_')) {
              // Перейти в ветку
              if (!userChat.threadId) {
                await safeReply(interaction, { content: '❌ Тред не найден.', ephemeral: true });
                return;
              }
              await safeReply(interaction, { content: `🚀 Ссылка на ветку: <#${userChat.threadId}>`, ephemeral: true });
            } else if (interaction.customId.startsWith('ai_action_close_')) {
              // Закрыть ветку
              if (userChat.threadId) {
                const thread = await client.channels.fetch(userChat.threadId).catch(() => null);
                if (thread && typeof thread.setArchived === 'function') {
                  try { await thread.setArchived(true); } catch (e) { console.warn('Failed to archive thread', e); }
                }
              }
              userChat.status = 'closed';
              userChat.closedAt = new Date().toISOString();
              await db.set('aiChats', allChats);
              await safeReply(interaction, { content: `✅ Ветка ${userChat.chatId} закрыта.`, ephemeral: true });
            }
          } catch (err) {
            console.error('AI action button error', err);
            await safeReply(interaction, { content: 'Ошибка при выполнении действия.', ephemeral: true });
          }
          return;
        }

        // Обработка основных кнопок (регистрация, создание новой, список)
        try { await handleAiButton(interaction); } catch (err) { console.error('AI button error', err); await safeReply(interaction, { content: 'Ошибка при обработке кнопки ИИ.', ephemeral: true }); }
        return;
      }
      // Menu buttons
      if (interaction.customId && interaction.customId.startsWith('menu_')) {
        try { await handleMenuButton(interaction); } catch (err) { console.error('Menu button error', err); await safeReply(interaction, { content: 'Ошибка при обработке меню.', ephemeral: true }); }
        return;
      }
      // Post Manager buttons
      if (interaction.customId && interaction.customId.startsWith('post_')) {
        try { await handlePostManagerButton(interaction); } catch (err) { console.error('Post manager button error', err); await safeReply(interaction, { content: 'Ошибка при управлении постом.', ephemeral: true }); }
        return;
      }
      // Player panel buttons (Viht player v.4214)
      if (interaction.customId && interaction.customId.startsWith('player_')) {
        try { await handlePlayerPanelButton(interaction, client); } catch (err) { console.error('Player panel button error', err); await safeReply(interaction, { content: 'Ошибка при управлении плеером.', ephemeral: true }); }
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
      // Profile buttons
      if (interaction.customId === 'profile_music_stats') {
        try {
          const musicEmbeds = require('./music-interface/musicEmbeds');
          const music = db.get('music') || {};
          const userId = interaction.user.id;
          const guildId = interaction.guildId;
          const historyTracks = (music.history && music.history[`${guildId}_${userId}`]) || [];
          const favTracks = (music.favorites && music.favorites[`${guildId}_${userId}`]) || [];
          const playlists = (music.playlists && music.playlists[`${guildId}_${userId}`]) || {};
          
          const embed = musicEmbeds.createPlaylistsEmbed(playlists);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('profile_show_history').setLabel('История').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('profile_show_favorites').setLabel('Избранное').setStyle(ButtonStyle.Secondary)
          );
          await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
        } catch (err) {
          console.error('Profile music stats error', err);
          await safeReply(interaction, { content: 'Ошибка при загрузке статистики музыки.', ephemeral: true });
        }
        return;
      }
      if (interaction.customId === 'profile_show_history') {
        try {
          const musicEmbeds = require('./music-interface/musicEmbeds');
          const music = db.get('music') || {};
          const userId = interaction.user.id;
          const guildId = interaction.guildId;
          const historyTracks = (music.history && music.history[`${guildId}_${userId}`]) || [];
          
          const embed = musicEmbeds.createHistoryEmbed(historyTracks);
          await safeUpdate(interaction, { embeds: [embed] });
        } catch (err) {
          console.error('Profile history error', err);
          await safeReply(interaction, { content: 'Ошибка при загрузке истории.', ephemeral: true });
        }
        return;
      }
      if (interaction.customId === 'profile_show_favorites') {
        try {
          const musicEmbeds = require('./music-interface/musicEmbeds');
          const music = db.get('music') || {};
          const userId = interaction.user.id;
          const guildId = interaction.guildId;
          const favTracks = (music.favorites && music.favorites[`${guildId}_${userId}`]) || [];
          
          const embed = musicEmbeds.createFavoritesEmbed(favTracks);
          await safeUpdate(interaction, { embeds: [embed] });
        } catch (err) {
          console.error('Profile favorites error', err);
          await safeReply(interaction, { content: 'Ошибка при загрузке избранного.', ephemeral: true });
        }
        return;
      }
      if (interaction.customId === 'profile_achievements') {
        try {
          const achievements = musicPlayer.getAchievements(interaction.user.id);
          const achievementList = Object.entries(achievements).map(([name, data]) => {
            return `**${name}**: ${data.count || 0} (разблокировано: ${data.unlockedAt || '—'})`;
          }).join('\n') || 'Нет достижений';
          
          const embed = new EmbedBuilder()
            .setTitle(`🏆 Достижения — ${interaction.user.username}`)
            .setDescription(achievementList)
            .setColor(0xFFD700)
            .setFooter({ text: 'Заработайте достижения, используя различные функции бота!' });
          
          await safeReply(interaction, { embeds: [embed], ephemeral: true });
        } catch (err) {
          console.error('Profile achievements error', err);
          await safeReply(interaction, { content: 'Ошибка при загрузке достижений.', ephemeral: true });
        }
        return;
      }
      // DM Menu buttons
      if (interaction.customId && interaction.customId.startsWith('dm_menu_')) {
        try {
          const dmMenu = require('./dm-menu');
          await dmMenu.handleDMMenuButton(interaction);
        } catch (err) {
          console.error('DM menu button error', err);
          await safeReply(interaction, { content: 'Ошибка при обработке меню.', ephemeral: true });
        }
        return;
      }
      // DM lounge player buttons
      if (interaction.customId && interaction.customId.startsWith('dm_lounge_')) {
        try {
          const cid = interaction.customId;
          // find a guild where this user is in a voice channel and bot is connected
          let targetGuild = null;
          for (const g of interaction.client.guilds.cache.values()) {
            try {
              const member = await g.members.fetch(interaction.user.id).catch(() => null);
              if (!member) continue;
              const vch = member.voice && member.voice.channel ? member.voice.channel : null;
              const botMember = await g.members.fetch(interaction.client.user.id).catch(() => null);
              if (vch && botMember && botMember.voice && botMember.voice.channel && botMember.voice.channel.id === vch.id) {
                targetGuild = g; break;
              }
            } catch (e) { /* ignore */ }
          }
          if (!targetGuild) { await safeReply(interaction, { content: '❌ Не найден подключённый голосовой канал для управления.', ephemeral: true }); return; }
          const musicPlayer = require('./music/player2');
          if (cid === 'dm_lounge_pause') {
            await musicPlayer.pause(targetGuild).catch(() => {});
            await safeReply(interaction, { content: '⏸ Пауза отправлена.', ephemeral: true });
            return;
          }
          if (cid === 'dm_lounge_skip') {
            await musicPlayer.skip(targetGuild).catch(() => {});
            await safeReply(interaction, { content: '⏭ Трек пропущен.', ephemeral: true });
            return;
          }
          if (cid === 'dm_lounge_repeat') {
            try {
              const newState = await musicPlayer.toggleRepeat(targetGuild.id).catch(() => null);
              await safeReply(interaction, { content: `🔁 Repeat is now ${newState ? 'ON' : 'OFF'}.`, ephemeral: true });
            } catch (e) { await safeReply(interaction, { content: 'Ошибка при переключении Repeat.', ephemeral: true }); }
            return;
          }
          if (cid === 'dm_lounge_shuffle') {
            try {
              const newState = await musicPlayer.toggleShuffle(targetGuild.id).catch(() => null);
              await safeReply(interaction, { content: `🔀 Shuffle is now ${newState ? 'ON' : 'OFF'}.`, ephemeral: true });
            } catch (e) { await safeReply(interaction, { content: 'Ошибка при переключении Shuffle.', ephemeral: true }); }
            return;
          }
          if (cid === 'dm_lounge_close') {
            try { await interaction.message.delete().catch(() => {}); } catch (e) {}
            await safeReply(interaction, { content: 'Окно Lounge закрыто.', ephemeral: true });
            return;
          }
        } catch (err) {
          console.error('DM lounge handler error', err);
          await safeReply(interaction, { content: 'Ошибка при управлении Lounge.', ephemeral: true });
        }
        return;
      }
      // Music search button selection
      if (interaction.customId && interaction.customId.startsWith('music_search_btn_')) {
        try {
          const parts = interaction.customId.split('_');
          const searchId = [parts[3], parts[4]].join('_'); // reconstruct searchId
          const trackIdx = parseInt(parts[5], 10);
          const cache = global._musicSearchCache && global._musicSearchCache[searchId];
          if (!cache) {
            await safeReply(interaction, { content: '❌ Поиск истёк. Попробуйте ещё раз.', ephemeral: true });
            return;
          }
          const candidate = cache.candidates[trackIdx];
          if (!candidate) {
            await safeReply(interaction, { content: '❌ Трек не найден.', ephemeral: true });
            return;
          }
          const guild = interaction.guild || (client && await client.guilds.fetch(cache.guildId).catch(() => null));
          const voiceChannel = guild && await guild.channels.fetch(cache.voiceChannelId).catch(() => null);
          if (!guild || !voiceChannel) {
            await safeReply(interaction, { content: '❌ Не удалось найти сервер или голосовой канал.', ephemeral: true });
            return;
          }
          const query = candidate.url || candidate.title || candidate;
          await safeReply(interaction, { content: `🎵 Начинаю воспроизведение "${(candidate.title || '').slice(0, 50)}"...`, ephemeral: true });

          // Try playing this candidate; if it fails, try next candidates from cache
          let played = false;
          const candidatesList = cache.candidates || [];
          for (let tryIdx = trackIdx; tryIdx < candidatesList.length; tryIdx++) {
            const cand = candidatesList[tryIdx];
            if (!cand) continue;
            const q = cand.url || cand.title || cand;
            try {
              const ok = await musicPlayer.playNow(guild, voiceChannel, q, interaction.channel, cache.userId).catch(err => { console.error('playNow error', err); return false; });
              if (ok) { played = true; break; }
            } catch (e) { console.error('playNow threw', e); }
          }
          if (!played) {
            // Update the in-channel control message with error if possible
            try { await updateControlMessageWithError(guild.id, client, '❌ Не удалось воспроизвести выбранный трек и альтернативы.'); } catch (e) {}
            try { await safeReply(interaction, { content: '❌ Не удалось воспроизвести выбранный трек и альтернативы.', ephemeral: true }); } catch (e) {}
          }
          delete global._musicSearchCache[searchId];
          return;
        } catch (e) {
          console.error('music search button error', e);
          await safeReply(interaction, { content: '❌ Ошибка при выборе трека.', ephemeral: true });
        }
        return;
      }
      return;
    }
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      // Handle AI chat select menu (choose chat from list, then show action buttons)
      if (interaction.customId && interaction.customId.startsWith('ai_chat_select_')) {
        try {
          await db.ensureReady();
          const allChats = db.get('aiChats') || {};
          // Get the userId from the select menu value (stored when building the menu)
          const selectedUserId = String(interaction.values[0]);
          const userChat = allChats[selectedUserId];
          
          if (!userChat) {
            await safeReply(interaction, { content: '❌ Ветка не найдена.', ephemeral: true });
            return;
          }

          // Show action buttons: перейти или закрыть
          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ai_action_goto_${selectedUserId}`)
              .setLabel('Перейти в ветку')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🚀'),
            new ButtonBuilder()
              .setCustomId(`ai_action_close_${selectedUserId}`)
              .setLabel('Закрыть ветку')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          );

          const embed = new EmbedBuilder()
            .setTitle('📌 Управление веткой')
            .setDescription(`**ID:** ${userChat.chatId}\n**Статус:** ${userChat.status || 'open'}`)
            .setColor(0x0055ff)
            .setFooter({ text: 'Выберите действие' });

          await safeReply(interaction, { embeds: [embed], components: [actionRow], ephemeral: true });
        } catch (e) {
          console.error('AI chat select error', e);
          await safeReply(interaction, { content: '❌ Ошибка при выборе ветки.', ephemeral: true });
        }
        return;
      }
      // Handle music search select menu
      if (interaction.customId && interaction.customId.startsWith('music_search_select_')) {
        try {
          const searchId = interaction.customId.split('music_search_select_')[1];
          const cache = global._musicSearchCache && global._musicSearchCache[searchId];
          if (!cache) {
            await safeReply(interaction, { content: '❌ Поиск истёк. Попробуйте ещё раз.', ephemeral: true });
            return;
          }
          const selectedIndices = interaction.values.map(v => parseInt(v, 10));
          const guild = interaction.guild || (client && await client.guilds.fetch(cache.guildId).catch(() => null));
          const voiceChannel = guild && await guild.channels.fetch(cache.voiceChannelId).catch(() => null);
          if (!guild || !voiceChannel) {
            await safeReply(interaction, { content: '❌ Не удалось найти сервер или голосовой канал.', ephemeral: true });
            return;
          }
          await safeReply(interaction, { content: `🎵 Начинаю воспроизведение ${selectedIndices.length} трека(ов)...`, ephemeral: true });

          // Add all selected tracks to queue and play first; if first fails try next selected
          let firstPlayed = false;
          for (let i = 0; i < selectedIndices.length; i++) {
            const idx = selectedIndices[i];
            const candidate = cache.candidates[idx];
            if (!candidate) continue;
            const query = candidate.url || candidate.title || candidate;
            if (i === 0) {
              // Try first, if it fails try subsequent selected indices
              for (let k = 0; k < selectedIndices.length; k++) {
                const candIdx = selectedIndices[k];
                const cand = cache.candidates[candIdx];
                if (!cand) continue;
                const q = cand.url || cand.title || cand;
                try {
                  const ok = await musicPlayer.playNow(guild, voiceChannel, q, interaction.channel, cache.userId).catch(err => { console.error('playNow error', err); return false; });
                  if (ok) { firstPlayed = true; break; }
                } catch (e) { console.error('playNow threw', e); }
              }
            } else {
              // Queue rest (avoid queuing if first didn't play)
              if (firstPlayed) await musicPlayer.addToQueue(guild, query).catch(e => console.error('addToQueue error', e));
            }
          }
          if (!firstPlayed) {
            try { await updateControlMessageWithError(guild.id, client, '❌ Не удалось воспроизвести выбранный трек(и).'); } catch (e) {}
            try { await safeReply(interaction, { content: '❌ Не удалось воспроизвести выбранный трек(и).', ephemeral: true }); } catch (e) {}
          }
          delete global._musicSearchCache[searchId];
          return;
        } catch (e) {
          console.error('music search select error', e);
          await safeReply(interaction, { content: '❌ Ошибка при выборе трека.', ephemeral: true });
        }
        return;
      }
    }
    if (interaction.isModalSubmit()) {
      // Handle support creation modal submission
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
      if (interaction.customId === 'music_search_modal' || interaction.customId === 'music_search_vk_modal') {
        try {
          // Defer immediately to avoid timeout
          await interaction.deferReply({ ephemeral: true });
          
          const isVK = interaction.customId === 'music_search_vk_modal';
          const songName = interaction.fields.getTextInputValue('song_name').slice(0, 200);
          const guild = interaction.guild;
          const member = interaction.member || (guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);
          const voiceChannel = member && member.voice ? member.voice.channel : null;
          if (!voiceChannel) {
            await interaction.editReply({ content: '❌ Вы не в голосовом канале.', ephemeral: true });
            return;
          }
          // Show searching message
          await interaction.editReply({ content: `🔎 Ищу варианты для "${songName}" ${isVK ? 'в VK' : 'на YouTube'}...`, ephemeral: true });
          
          let searchResults = null;
          
          // Search for candidates
          if (isVK) {
            // VK search with fallback to YouTube
            try {
              const vkHandler = require('./vk/vkHandler');
              const vkResults = await vkHandler.searchAudio(songName);
              if (vkResults && vkResults.length > 0) {
                searchResults = { candidates: vkResults, source: 'vk' };
              } else {
                console.warn('[Music Search] VK returned no results, falling back to YouTube');
              }
            } catch (vkErr) {
              console.warn('[Music Search] VK search failed:', vkErr.message, '- falling back to YouTube');
              // Fall back to YouTube
            }
            
            // If VK search failed or returned no results, try YouTube
            if (!searchResults) {
              try {
                searchResults = await musicPlayer.findYouTubeUrl(songName).catch(() => null);
                if (searchResults) {
                  searchResults.source = 'youtube';
                  console.log('[Music Search] Using YouTube results as fallback for VK search');
                }
              } catch (e) {
                console.error('[Music Search] YouTube fallback failed:', e.message);
              }
            }
          } else {
            // YouTube search
            searchResults = await musicPlayer.findYouTubeUrl(songName).catch(() => null);
            if (searchResults) searchResults.source = 'youtube';
          }
          
          if (!searchResults || !searchResults.candidates || searchResults.candidates.length === 0) {
            try { await interaction.followUp({ content: `❌ Не найдено вариантов для "${songName}". Попробуйте другой поиск.`, ephemeral: true }); } catch (e) {}
            return;
          }
          
          const candidates = searchResults.candidates.slice(0, 10); // limit to 10 options
          const searchId = `search_${Date.now()}_${interaction.user.id}`;
          
          // Create select menu or buttons for choosing
          let components = [];
          
          // If we have select menu support (limit 25 options), use that
          if (candidates.length <= 25) {
            const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
            const select = new StringSelectMenuBuilder()
              .setCustomId(`music_search_select_${searchId}`)
              .setPlaceholder('Выберите трек')
              .setMinValues(1)
              .setMaxValues(Math.min(candidates.length, 5)); // Allow multi-select up to 5
            
            for (let i = 0; i < candidates.length; i++) {
              const c = candidates[i];
              const label = (c.title || c.url || '').slice(0, 100);
              select.addOptions(
                new StringSelectMenuOptionBuilder()
                  .setLabel(label)
                  .setValue(`${i}`)
                  .setDescription(`[Вариант ${i+1}]`)
              );
            }
            components.push(new ActionRowBuilder().addComponents(select));
          } else {
            // Fallback to numbered buttons (1️⃣, 2️⃣, etc.)
            const buttons = [];
            for (let i = 0; i < Math.min(candidates.length, 10); i++) {
              const emoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'][i];
              buttons.push(new ButtonBuilder()
                .setCustomId(`music_search_btn_${searchId}_${i}`)
                .setLabel(`${i+1}. ${(candidates[i].title || candidates[i].url || '').slice(0,20)}...`)
                .setStyle(ButtonStyle.Secondary)
              );
            }
            for (let i = 0; i < buttons.length; i += 5) {
              components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }
          }
          
          // Store candidates temporarily (in memory, with timeout cleanup)
          if (!global._musicSearchCache) global._musicSearchCache = {};
          global._musicSearchCache[searchId] = { candidates, guildId: guild.id, voiceChannelId: voiceChannel.id, userId: interaction.user.id, timestamp: Date.now(), source: searchResults.source };
          setTimeout(() => { delete global._musicSearchCache[searchId]; }, 60000); // Clear after 60s
          
          // Show results
          const resultEmbed = new EmbedBuilder()
            .setTitle(`🎵 Результаты поиска ${searchResults.source === 'vk' ? '(VK)' : '(YouTube)'}`)
            .setColor(0x7289DA)
            .setDescription(`По запросу "${songName}" найдено ${candidates.length} результатов. Выберите трек(и):`)
            .addFields(candidates.slice(0, 5).map((c, i) => ({
              name: `${i+1}. ${(c.title || c.url).slice(0,50)}`,
              value: c.artist ? `${c.artist}` : '—',
              inline: false
            })));
          
          try { 
            await interaction.followUp({ embeds: [resultEmbed], components, ephemeral: true }); 
          } catch (e) { 
            console.warn('followUp failed', e); 
            try { await interaction.channel.send({ embeds: [resultEmbed], components }); } catch (e2) {}
          }
          return;
        } catch (e) { 
          console.error('music_search modal submit error', e); 
          try { await interaction.editReply({ content: 'Ошибка при поиске песни.', ephemeral: true }); } catch (e2) { console.warn('editReply failed', e2); }
        }
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
      // Player panel modals (search and queue)
      if (interaction.customId && (interaction.customId.startsWith('player_search_modal_') || interaction.customId.startsWith('player_queue_modal_'))) {
        try { await handlePlayerPanelModal(interaction, client); } catch (err) { console.error('Player panel modal error', err); await safeReply(interaction, { content: 'Ошибка при обработке формы.', ephemeral: true }); }
        return;
      }
      // VK модали
      if (interaction.customId && interaction.customId.startsWith('vk_id_modal_')) {
        try {
          const vkHandler = require('./vk/vkMusicHandler');
          await vkHandler.handleVkIdModal(interaction);
        } catch (err) { console.error('VK modal error', err); await safeReply(interaction, { content: 'Ошибка при обработке формы.', ephemeral: true }); }
        return;
      }
      // Post Manager modals
      if (interaction.customId && interaction.customId.startsWith('post_') && interaction.customId.includes('modal')) {
        try {
          console.log('[POST_MANAGER] Обработка модали:', interaction.customId);
          await handlePostManagerModal(interaction);
        } catch (err) { 
          console.error('[POST_MANAGER] Ошибка модали:', err.message, err.stack); 
          try {
            await interaction.reply({ content: '❌ Ошибка формы: ' + err.message, ephemeral: true });
          } catch (replyErr) {
            console.error('[POST_MANAGER] Не удалось отправить ошибку пользователю:', replyErr.message);
          }
        }
        return;
      }
    }
    // Handle all select menus (including channel, string select, etc)
    if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()) {
      // VK music select
      if (interaction.customId && interaction.customId.startsWith('vk_music_select_')) {
        try {
          const vkHandler = require('./vk/vkMusicHandler');
          await vkHandler.handleMusicSelect(interaction);
        } catch (err) { console.error('VK music select error', err); await safeReply(interaction, { content: 'Ошибка при выборе.', ephemeral: true }); }
        return;
      }
      // Post Manager channel/color select
      if (interaction.customId && interaction.customId.startsWith('post_')) {
        try { await handlePostManagerSelect(interaction); } catch (err) { console.error('Post manager select error', err); await safeReply(interaction, { content: 'Ошибка при выборе.', ephemeral: true }); }
        return;
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

// (Channel constants declared earlier)

async function findRecentAuditEntry(guild, predicate, windowMs = 10000) {
  try {
    const logs = await guild.fetchAuditLogs({ limit: 30 }).catch(() => null);
    if (!logs || !logs.entries) return null;
    const now = Date.now();
    for (const entry of logs.entries.values()) {
      try {
        const created = entry.createdAt ? entry.createdAt.getTime() : (entry.createdTimestamp || 0);
        if (now - created > windowMs) continue;
        if (typeof predicate === 'function' && predicate(entry)) return entry;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

async function sendActivityEmbed(guild, embed, channelId = VOICE_LOG_CHANNEL) {
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased && ch.isTextBased()) {
      await ch.send({ embeds: [embed] }).catch(() => null);
    }
  } catch (e) { console.warn('sendActivityEmbed failed', e && e.message); }
}

// Voice state: detect server mute/unmute and forced disconnects (kicks)
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const guild = oldState.guild || newState.guild;
    if (!guild) return;
    const member = newState.member || oldState.member;

    // Server mute/unmute
    try {
      if (oldState.serverMute !== newState.serverMute) {
        const action = newState.serverMute ? 'Выключил микрофон (заглушил)' : 'Включил микрофон (разглушил)';
        const audit = await findRecentAuditEntry(guild, e => String(e.targetId) === String(member.id));
        const by = audit && audit.executor ? `<@${audit.executor.id}>` : 'Неизвестно';
        const embed = new EmbedBuilder()
          .setTitle('🔇 Изменение микрофона')
          .setColor(newState.serverMute ? 0xFF5252 : 0x4CAF50)
          .setDescription(`${by} — ${action} у пользователя <@${member.id}>`)
          .addFields(
            { name: 'Сервер', value: `${guild.name}`, inline: true },
            { name: 'Пользователь', value: `<@${member.id}>`, inline: true }
          )
          .setTimestamp();
        await sendActivityEmbed(guild, embed, VOICE_LOG_CHANNEL);
      }
    } catch (e) {}

    // Kicked/disconnected from voice (someone forced them out)
    try {
      if (oldState.channel && !newState.channel) {
        // They left/moved out of voice. Try to find an audit entry that indicates a forced disconnect
        const audit = await findRecentAuditEntry(guild, e => String(e.targetId) === String(member.id));
        const by = audit && audit.executor ? `<@${audit.executor.id}>` : null;
        const title = by ? '👢 Выгнан из голосового' : '🏃 Вышел из голосового';
        const color = by ? 0xFF7043 : 0x607D8B;
        const desc = by ? `${by} выгнал(а) <@${member.id}> из голосового канала ${oldState.channel ? `**${oldState.channel.name}**` : ''}` : `<@${member.id}> покинул(а) голосовой канал ${oldState.channel ? `**${oldState.channel.name}**` : ''}`;
        const embed = new EmbedBuilder().setTitle(title).setColor(color).setDescription(desc).addFields(
          { name: 'Сервер', value: `${guild.name}`, inline: true },
          { name: 'Канал', value: oldState.channel ? `${oldState.channel.name}` : '—', inline: true }
        ).setTimestamp();
        await sendActivityEmbed(guild, embed, VOICE_LOG_CHANNEL);
      }
    } catch (e) {}
  } catch (e) { console.error('voiceStateUpdate handler failed', e && e.message); }
});

// Nickname change logging
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const guild = newMember.guild || oldMember.guild;
    if (!guild) return;
    const oldNick = oldMember.nickname || oldMember.displayName || '';
    const newNick = newMember.nickname || newMember.displayName || '';
    if (oldNick !== newNick) {
      const audit = await findRecentAuditEntry(guild, e => String(e.targetId) === String(newMember.id));
      const by = audit && audit.executor ? `<@${audit.executor.id}>` : 'Неизвестно';
      const embed = new EmbedBuilder().setTitle('✏️ Изменение ника')
        .setColor(0xFFC107)
        .setDescription(`${by} изменил(а) ник пользователя <@${newMember.id}>`)
        .addFields(
          { name: 'Старый ник', value: oldNick || '—', inline: true },
          { name: 'Новый ник', value: newNick || '—', inline: true }
        )
        .setTimestamp();
      await sendActivityEmbed(guild, embed, NICK_CHANGE_LOG_CHANNEL);
    }
  } catch (e) { console.error('guildMemberUpdate handler failed', e && e.message); }
});

// Message deletion logging
client.on('messageDelete', async (message) => {
  try {
    if (!message || !message.guild) return;
    const guild = message.guild;
    const channel = message.channel;
    const author = message.author;
    // If the author was a bot, skip logging
    if (author && author.bot) return;

    // try to find an audit entry for a moderator deletion
    const audit = await findRecentAuditEntry(guild, e => {
      try {
        // Some audit entries include extra.channel (deleted messages count), match by channel id
        if (e.extra && e.extra.channel && String(e.extra.channel.id) === String(channel.id)) return true;
        if (String(e.targetId) === String(author && author.id)) return true;
      } catch (ee) {}
      return false;
    }, 15000);
    // If audit shows the bot (this client) deleted the message (e.g. via a moderation/cleanup command), do not log
    if (audit && audit.executor && String(audit.executor.id) === String(client.user.id)) return;
    const by = audit && audit.executor ? `<@${audit.executor.id}>` : (author ? `<@${author.id}> (сам)` : 'Неизвестно');
    const content = message.content ? (message.content.length > 1000 ? message.content.slice(0,1000) + '…' : message.content) : (message.embeds && message.embeds.length ? '[embed]' : '[нет текста]');
    const embed = new EmbedBuilder().setTitle('🗑️ Удалено сообщение')
      .setColor(0x9E9E9E)
      .addFields(
        { name: 'Автор', value: author ? `<@${author.id}>` : 'Неизвестно', inline: true },
        { name: 'Удалил', value: by, inline: true },
        { name: 'Канал', value: channel ? `${channel.name}` : '—', inline: true },
        { name: 'Содержимое', value: content }
      ).setTimestamp();
    await sendActivityEmbed(guild, embed, MESSAGE_EDIT_LOG_CHANNEL);
  } catch (e) { console.error('messageDelete handler failed', e && e.message); }
});
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
// Guild member join event — create DM menu for new members
client.on('guildMemberAdd', async (member) => {
  try {
    const dmMenu = require('./dm-menu');
    await dmMenu.createUserMenu(client, member.id, member.guild.id);
  } catch (err) {
    console.error('guildMemberAdd DM menu error:', err.message);
  }
});
// Hourly cleanup task for DM menus
setInterval(async () => {
  try {
    const dmMenu = require('./dm-menu');
    // Get all bot guilds and iterate through members to cleanup their DM messages
    for (const guild of client.guilds.cache.values()) {
      const members = await guild.members.fetch({ limit: 100 }).catch(() => null);
      if (!members) continue;
      for (const member of members.values()) {
        if (member.user.bot) continue;
        await dmMenu.cleanupOldMenuMessages(member.user, client).catch(() => {});
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      }
    }
  } catch (err) {
    console.error('Hourly DM cleanup error:', err.message);
  }
}, 3600000); // 1 hour = 3600000 ms
// AI chat handler
const { aiChatChannelId } = require('./config');
const COOLDOWN_MS = 3000;
const lastMessageAt = new Map();
const processedMessages = new Set(); // Track processed messages
client.on('messageCreate', async (message) => {
  try {
    if (message.author?.bot) return;
    if (!message.channel) return;
    
    // Post Manager message input
    try {
      const { handlePostMessageInput } = require('./post-manager/postManager');
      await handlePostMessageInput(message);
    } catch (e) {
      console.warn('Post Manager message input error:', e && e.message ? e.message : e);
    }
    
    // Проверка на матерные слова - работает на всех каналах
    try {
      const { checkMessage } = require('./moderation/badwordHandler');
      await checkMessage(message, client);
    } catch (e) {
      console.warn('Badword check failed:', e && e.message ? e.message : e);
    }
    
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
  
  // Post Viht player v.4214 panel to control channel
  try {
    console.log('[PLAYER] Starting postPlayerMessage...');
    const result = await postPlayerMessage(client);
    console.log('[PLAYER] postPlayerMessage result:', result ? 'SUCCESS' : 'FAILED');
  } catch (e) {
    console.error('[PLAYER] Exception in postPlayerMessage:', e.message, e.stack);
  }
  
  // Schedule periodic player panel refresh (every 5 minutes)
  try {
    setInterval(async () => {
      try {
        console.log('[PLAYER] Refreshing player panel...');
        await postPlayerMessage(client);
      } catch (e) {
        console.warn('[PLAYER] Periodic refresh failed:', e.message);
      }
    }, 5 * 60 * 1000);
  } catch (e) {
    console.warn('[PLAYER] Failed to schedule periodic refresh:', e.message);
  }
  
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
  // Send a polished startup embed into the command/log channel so staff see restarts
  try {
    const logChannelId = COMMAND_LOG_CHANNEL;
    const statusChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (statusChannel && statusChannel.isTextBased && statusChannel.isTextBased()) {
      const { date, time } = formatDateTimeMSK(botStartTime);
      let version = 'unknown';
      try { version = (fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf-8') || '').trim() || version; } catch (e) {}
      let gitSha = 'unknown';
      try { const { execSync } = require('child_process'); gitSha = String(execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), timeout: 2000 })).trim(); } catch (e) {}
      const embed = new EmbedBuilder()
        .setTitle('✅ Бот запущен')
        .setColor(0x4CAF50)
        .setThumbnail(client.user.displayAvatarURL({ size: 64 }))
        .addFields(
          { name: 'Бот', value: `${client.user.tag}`, inline: true },
          { name: 'Дата (MSK)', value: `${date}`, inline: true },
          { name: 'Время (MSK)', value: `${time}`, inline: true },
          { name: 'Версия', value: `${version}`, inline: true },
          { name: 'Commit', value: `${gitSha}`, inline: true },
          { name: 'Серверов', value: `${client.guilds.cache.size}`, inline: true }
        )
        .setFooter({ text: 'Авто-уведомление о запуске' })
        .setTimestamp();
      await statusChannel.send({ embeds: [embed] }).catch(() => null);
      console.log('Startup embed posted to', logChannelId, 'version', version, 'commit', gitSha);
    }
  } catch (e) {
    console.warn('Failed to post startup embed:', e && e.message ? e.message : e);
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
  // Ensure main navigation menu in menu channel
  try {
    await ensureMenuPanel(client);
    setInterval(async () => { try { await ensureMenuPanel(client); } catch (e) { /* ignore */ } }, 5 * 60 * 1000);
  } catch (e) { console.warn('Failed to ensure menu panel on ready:', e && e.message ? e.message : e); }
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
  // Post Post Manager panel
  try {
    await postPostManagerPanel(client);
    setInterval(async () => { try { await postPostManagerPanel(client); } catch (e) { /* ignore */ } }, 5 * 60 * 1000);
  } catch (e) { console.warn('Failed to post manager panel on ready:', e && e.message ? e.message : e); }
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
