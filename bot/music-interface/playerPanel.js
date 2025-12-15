const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../libs/db');
const musicPlayer = require('../music/player2');

const CONTROL_PANEL_CHANNEL_ID = '1443194196172476636';
const DEFAULT_VOICE_CHANNEL_ID = '1449757724274589829'; // Войс отзывов куда возвращается бот

// Store active player sessions: { userId -> { messageId, guildId, voiceChannelId, currentTrack, isPlaying } }
const playerSessions = new Map();

// Store activity timeouts: { userId -> timeoutId }
const sessionTimeouts = new Map();

/**
 * Сбросить таймаут неактивности для пользователя (10 минут)
 * Если 10 минут никто не нажимает кнопки - бот идёт в войс отзывов
 */
function resetActivityTimeout(userId, client) {
  // Очищаем старый таймаут если есть
  if (sessionTimeouts.has(userId)) {
    clearTimeout(sessionTimeouts.get(userId));
  }
  
  // Устанавливаем новый таймаут (10 минут = 600000 мс)
  const timeout = setTimeout(async () => {
    console.log(`[PLAYER-TIMEOUT] Неактивность пользователя ${userId}, возврат бота в войс отзывов`);
    const session = playerSessions.get(userId);
    if (session) {
      try {
        const guild = await client.guilds.fetch(session.guildId).catch(() => null);
        if (guild) {
          await musicPlayer.stop(guild).catch(() => null);
          playerSessions.delete(userId);
        }
      } catch (e) {
        console.warn('[PLAYER-TIMEOUT] Ошибка при остановке:', e.message);
      }
    }
    sessionTimeouts.delete(userId);
  }, 10 * 60 * 1000); // 10 минут
  
  sessionTimeouts.set(userId, timeout);
}

// Build initial "Занять плеер" embed and button
function buildOccupyEmbed() {
  return new EmbedBuilder()
    .setTitle('🎵 Viht player v.4214')
    .setColor(0x2C3E50)
    .setDescription('🎶 Добро пожаловать в музыкальный плеер!\n\n✨ Нажмите кнопку ниже, чтобы занять плеер и начать слушать музыку.')
    .setFooter({ text: '🎵 Viht Audio System' })
    .setTimestamp();
}

function buildOccupyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('player_occupy')
      .setLabel('🎵 Занять плеер')
      .setStyle(ButtonStyle.Primary)
    // VK music button disabled temporarily
    // new ButtonBuilder()
    //   .setCustomId('player_vk_music')
    //   .setLabel('🎵 Моя музыка (VK)')
    //   .setStyle(ButtonStyle.Success)
  );
}

// Build playing embed with current track info
function buildPlayingEmbed(session, trackTitle = 'Загрузка...') {
  const titleDisplay = trackTitle && trackTitle !== 'Загрузка...' 
    ? trackTitle.slice(0, 100) 
    : '🎵 Ищем песню...';
  
  return new EmbedBuilder()
    .setTitle('🎵 Viht player v.4214')
    .setColor(0x00AA00)
    .setDescription(`**Сейчас играет:**\n\`${titleDisplay}\`\n\n🎧 Плеер занят пользователем <@${session.userId}>`)
    .setFooter({ text: '🎵 Viht Audio System' })
    .setTimestamp();
}

// Build control buttons row (Find Song, Previous, etc.)
function buildControlRow(isPlaying = false) {
  const buttons = [];
  
  buttons.push(
    new ButtonBuilder()
      .setCustomId('player_find_song')
      .setLabel('🔍 Найти песню')
      .setStyle(ButtonStyle.Primary)
  );
  
  if (isPlaying) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('player_add_next')
        .setLabel('➕ Добавить следующую')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  
  buttons.push(
    new ButtonBuilder()
      .setCustomId('player_back')
      .setLabel('◀️ Назад')
      .setStyle(ButtonStyle.Danger)
  );
  
  return new ActionRowBuilder().addComponents(...buttons);
}

// Post initial player message to control panel channel
async function postPlayerMessage(client) {
  try {
    console.log('[PLAYER] postPlayerMessage called');
    
    if (!client) {
      console.error('[PLAYER] client is null/undefined');
      return null;
    }
    
    if (!client.channels) {
      console.error('[PLAYER] client.channels is null/undefined');
      return null;
    }
    
    console.log('[PLAYER] Attempting to fetch channel:', CONTROL_PANEL_CHANNEL_ID);
    
    const controlChannel = await client.channels.fetch(CONTROL_PANEL_CHANNEL_ID).catch((err) => {
      console.error('[PLAYER] Failed to fetch control channel:', err.message, err.code);
      return null;
    });
    
    if (!controlChannel) {
      console.error('[PLAYER] Control channel is null after fetch');
      return null;
    }
    
    console.log('[PLAYER] Channel fetched:', controlChannel.id, 'type:', controlChannel.type);
    
    if (!controlChannel.isTextBased || !controlChannel.isTextBased()) {
      console.error('[PLAYER] Control channel is not text-based, type:', controlChannel.type);
      return null;
    }
    
    console.log('[PLAYER] Building embeds and buttons');
    const embed = buildOccupyEmbed();
    const row = buildOccupyRow();
    
    // Check if message already exists in DB
    console.log('[PLAYER] Checking DB for existing message');
    const existingRecord = db.get('playerPanelMessage');
    console.log('[PLAYER] Existing record:', existingRecord);
    
    if (existingRecord && existingRecord.messageId) {
      try {
        console.log('[PLAYER] Fetching existing message:', existingRecord.messageId);
        const existingMsg = await controlChannel.messages.fetch(existingRecord.messageId).catch((err) => {
          console.warn('[PLAYER] Error fetching existing message:', err.message);
          return null;
        });
        
        if (existingMsg) {
          console.log('[PLAYER] Found existing message, updating it');
          // Message exists, just update it
          await existingMsg.edit({ embeds: [embed], components: [row] }).catch((err) => {
            console.error('[PLAYER] Error editing message:', err.message);
            return null;
          });
          console.log('[PLAYER] Updated existing player panel message:', existingRecord.messageId);
          return existingMsg;
        }
      } catch (e) {
        console.warn('[PLAYER] Exception fetching existing message:', e.message);
      }
    }
    
    console.log('[PLAYER] Posting new message to channel');
    // Post new message
    const msg = await controlChannel.send({ embeds: [embed], components: [row] }).catch((err) => {
      console.error('[PLAYER] Failed to send player panel message:', err.message, err.code);
      return null;
    });
    
    if (msg) {
      console.log('[PLAYER] Message posted successfully:', msg.id);
      // Save message ID to DB
      try {
        db.set('playerPanelMessage', { messageId: msg.id, channelId: CONTROL_PANEL_CHANNEL_ID, postedAt: Date.now() });
        console.log('[PLAYER] Saved message ID to DB');
      } catch (e) {
        console.warn('[PLAYER] Failed to save message ID to DB:', e.message);
      }
      return msg;
    } else {
      console.error('[PLAYER] Message posting returned null');
      return null;
    }
  } catch (e) {
    console.error('[PLAYER] postPlayerMessage exception:', e.message, e.stack);
    return null;
  }
}

// Handle "Занять плеер" button click
async function handleOccupy(interaction, client) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId || interaction.guild?.id;
    const member = interaction.member || (guildId ? await interaction.guild?.members.fetch(userId).catch(() => null) : null);
    
    if (!member || !member.voice?.channel) {
      return await interaction.reply({ content: '❌ Вы должны быть в голосовом канале', ephemeral: true }).catch(() => null);
    }
    
    const voiceChannel = member.voice.channel;
    
    // Store session
    playerSessions.set(userId, {
      userId,
      guildId,
      voiceChannelId: voiceChannel.id,
      currentTrack: null,
      isPlaying: false,
      messageId: interaction.message.id
    });
    
    // Запускаем таймаут неактивности (10 минут)
    resetActivityTimeout(userId, client);
    
    // Update message with control buttons
    const embed = buildPlayingEmbed({ userId }, '⏳ Плеер готов к работе...');
    const row = buildControlRow(false);
    
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
  } catch (e) {
    console.error('handleOccupy error:', e.message);
    await interaction.reply({ content: '❌ Ошибка при занятии плеера', ephemeral: true }).catch(() => null);
  }
}

// Handle "Найти песню" button click - show modal
async function handleFindSong(interaction, client) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Плеер не занят. Нажмите "Занять плеер"', ephemeral: true }).catch(() => null);
    }
    
    // Сбросить таймаут неактивности
    resetActivityTimeout(userId, client);
    
    const modal = new ModalBuilder()
      .setCustomId(`player_search_modal_${userId}`)
      .setTitle('🔍 Поиск песни')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('song_query')
            .setLabel('Название песни или артист')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('например: The Weeknd - Blinding Lights')
            .setRequired(true)
        )
      );
    
    await interaction.showModal(modal).catch(() => null);
  } catch (e) {
    console.error('handleFindSong error:', e.message);
    await interaction.reply({ content: '❌ Ошибка', ephemeral: true }).catch(() => null);
  }
}

// Handle search modal submission
async function handleSearchModalSubmit(interaction, client) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Сессия плеера истекла', ephemeral: true }).catch(() => null);
    }
    
    const songQuery = interaction.fields.getTextInputValue('song_query').trim();
    
    // Defer the interaction
    await interaction.deferUpdate().catch(() => null);
    
    // Get guild and voice channel
    const guild = await client.guilds.fetch(session.guildId).catch(() => null);
    if (!guild) return;
    
    const voiceChannel = await guild.channels.fetch(session.voiceChannelId).catch(() => null);
    if (!voiceChannel) return;
    
    // Search for song on YouTube
    const searchResults = await musicPlayer.findYouTubeUrl(songQuery).catch(() => null);
    
    if (!searchResults || !searchResults.candidates || searchResults.candidates.length === 0) {
      // Update message with error
      const embed = buildPlayingEmbed(session, `❌ Не найдено для "${songQuery}"`);
      const row = buildControlRow(false);
      
      await interaction.message.edit({ embeds: [embed], components: [row] }).catch(() => null);
      return;
    }
    
    const candidates = searchResults.candidates.slice(0, 10); // Limit to 10
    const searchId = `player_search_${Date.now()}_${userId}`;
    
    // Store search results temporarily
    if (!global._playerSearchCache) global._playerSearchCache = {};
    global._playerSearchCache[searchId] = { 
      candidates, 
      guildId: session.guildId, 
      voiceChannelId: session.voiceChannelId, 
      userId: userId,
      messageId: interaction.message.id,
      session: session
    };
    setTimeout(() => { delete global._playerSearchCache[searchId]; }, 120000);
    
    // Create select menu
    const components = [];
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    
    try {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`player_search_select_${searchId}`)
        .setPlaceholder('Выберите трек')
        .setMinValues(1)
        .setMaxValues(1);
      
      for (let i = 0; i < candidates.length && i < 25; i++) {
        const c = candidates[i];
        const label = (c.title || c.url || '').slice(0, 95);
        if (label.length > 0) {
          select.addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(label)
              .setValue(`${i}`)
              .setDescription(`Вариант ${i+1}/${candidates.length}`)
          );
        }
      }
      
      components.push(new (require('discord.js')).ActionRowBuilder().addComponents(select));
    } catch (e) {
      console.error('Select menu creation failed:', e.message);
    }
    
    // If select menu failed, create buttons
    if (components.length === 0) {
      const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
      const buttons = [];
      for (let i = 0; i < Math.min(candidates.length, 5); i++) {
        buttons.push(new ButtonBuilder()
          .setCustomId(`player_search_btn_${searchId}_${i}`)
          .setLabel(`${i+1}. ${(candidates[i].title || '').slice(0, 20)}...`)
          .setStyle(ButtonStyle.Success)
        );
      }
      components.push(new ActionRowBuilder().addComponents(buttons));
    }
    
    // Create embed showing search results
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle(`🎵 Результаты поиска`)
      .setColor(0x00FF00)
      .setDescription(`По запросу: **${songQuery}**\n\nНайдено ${candidates.length} трек(а). **Выберите из меню:**`);
    
    const fields = candidates.slice(0, 10).map((c, i) => ({
      name: `${i+1}️⃣ ${(c.title || c.url || '').slice(0, 60)}`,
      value: 'Кликните чтобы выбрать',
      inline: false
    }));
    embed.addFields(fields);
    
    // Update the message with search results and selection menu
    await interaction.message.edit({ embeds: [embed], components }).catch(() => null);
    
    return;
  } catch (e) {
    console.error('handleSearchModalSubmit error:', e);
    await interaction.deferUpdate().catch(() => null);
  }
}

// Handle "Добавить следующую" button
async function handleAddNext(interaction, client) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Плеер не занят', ephemeral: true }).catch(() => null);
    }
    
    // Сбросить таймаут неактивности
    resetActivityTimeout(userId, client);
    
    const modal = new ModalBuilder()
      .setCustomId(`player_queue_modal_${userId}`)
      .setTitle('➕ Добавить песню в очередь')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('song_query')
            .setLabel('Название песни')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    
    await interaction.showModal(modal).catch(() => null);
  } catch (e) {
    console.error('handleAddNext error:', e.message);
    await interaction.reply({ content: '❌ Ошибка', ephemeral: true }).catch(() => null);
  }
}

// Handle queue modal submission
async function handleQueueModalSubmit(interaction, client) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Сессия истекла', ephemeral: true }).catch(() => null);
    }
    
    const songQuery = interaction.fields.getTextInputValue('song_query').trim();
    
    await interaction.deferUpdate().catch(() => null);
    
    const guild = await client.guilds.fetch(session.guildId).catch(() => null);
    if (!guild) return;
    
    // Add to queue
    const ok = await musicPlayer.addToQueue(guild, songQuery).catch(() => false);
    
    if (ok) {
      // Show success briefly (no message update needed, just silent add)
      console.log(`Added "${songQuery}" to queue for user ${userId}`);
    }
  } catch (e) {
    console.error('handleQueueModalSubmit error:', e.message);
    await interaction.reply({ content: '❌ Ошибка при добавлении', ephemeral: true }).catch(() => null);
  }
}

// Handle "Назад" button - stop and release player, then reconnect to reviews channel
async function handleBack(interaction, client) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Плеер не занят', ephemeral: true }).catch(() => null);
    }
    
    // Stop playback
    const guild = await client.guilds.fetch(session.guildId).catch(() => null);
    if (guild) {
      await musicPlayer.stop(guild).catch(() => null);
    }
    
    // Release player
    playerSessions.delete(userId);
    
    // Очистить таймаут
    if (sessionTimeouts.has(userId)) {
      clearTimeout(sessionTimeouts.get(userId));
      sessionTimeouts.delete(userId);
    }
    
    // Переподключить бота в канал отзывов (DEFAULT_VOICE_CHANNEL_ID)
    try {
      const { joinVoiceChannel } = require('@discordjs/voice');
      const reviewsChannel = await guild.channels.fetch(DEFAULT_VOICE_CHANNEL_ID).catch(() => null);
      
      if (reviewsChannel && reviewsChannel.isVoiceBased && reviewsChannel.isVoiceBased()) {
        joinVoiceChannel({
          channelId: DEFAULT_VOICE_CHANNEL_ID,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: true
        });
        console.log(`[PLAYER-BACK] ✅ Бот вернулся в канал отзывов после остановки музыки`);
      }
    } catch (err) {
      console.warn('[PLAYER-BACK] Ошибка при переподключении в канал отзывов:', err?.message);
    }
    
    // Update message back to initial state
    const embed = buildOccupyEmbed();
    const row = buildOccupyRow();
    
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
  } catch (e) {
    console.error('handleBack error:', e.message);
    await interaction.reply({ content: '❌ Ошибка при остановке', ephemeral: true }).catch(() => null);
  }
}

// Handle selection menu choice for search results
async function handleSearchSelectMenu(interaction, client) {
  try {
    const customId = interaction.customId;
    const searchId = customId.replace('player_search_select_', '');
    const cache = global._playerSearchCache?.[searchId];
    const interactionUserId = interaction.user.id;
    
    if (!cache) {
      console.warn('[PLAYER] Cache not found for searchId:', searchId);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    // ⚠️ ПРОВЕРКА ПРАВ: только владелец плеера может выбирать песни
    if (cache.userId && cache.userId !== interactionUserId) {
      console.warn(`[PLAYER] ❌ Попытка управления плеером от ${interactionUserId}, владелец ${cache.userId}`);
      return await interaction.reply({ content: '❌ Только владелец плеера может выбирать песни!', ephemeral: true }).catch(() => null);
    }
    
    console.log('[PLAYER] 🎵 handleSearchSelectMenu - cache:', {
      guildId: cache.guildId,
      voiceChannelId: cache.voiceChannelId,
      userId: cache.userId,
      session: cache.session
    });
    
    const selectedIndex = parseInt(interaction.values[0]);
    const selectedTrack = cache.candidates[selectedIndex];
    
    if (!selectedTrack) {
      console.warn('[PLAYER] Track not found at index:', selectedIndex);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    const trackUrl = selectedTrack.url || selectedTrack.link;
    const trackTitle = selectedTrack.title || 'Unknown';
    
    // Сбросить таймаут неактивности
    resetActivityTimeout(cache.userId, client);
    
    // Get guild and voice channel
    const guild = await client.guilds.fetch(cache.guildId).catch(() => null);
    if (!guild) {
      console.error('[PLAYER] ❌ Guild not found:', cache.guildId);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    if (!cache.voiceChannelId) {
      console.error('[PLAYER] ❌ voiceChannelId is NULL/UNDEFINED in cache!');
      const embed = buildPlayingEmbed(cache.session || { userId: cache.userId }, '❌ Ошибка: ID канала не найден');
      await interaction.update({ embeds: [embed] }).catch(() => null);
      return;
    }
    
    const voiceChannel = await guild.channels.fetch(cache.voiceChannelId).catch((err) => {
      console.error('[PLAYER] ❌ Failed to fetch voice channel:', cache.voiceChannelId, err?.message);
      return null;
    });
    
    if (!voiceChannel) {
      console.error('[PLAYER] ❌ voiceChannel is NULL after fetch');
      const embed = buildPlayingEmbed(cache.session || { userId: cache.userId }, '❌ Голосовой канал не найден');
      await interaction.update({ embeds: [embed] }).catch(() => null);
      return;
    }
    
    // Update the message to show now playing
    const { EmbedBuilder, ActionRowBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🎵 Viht player v.4214')
      .setColor(0x00AA00)
      .setDescription(`**Сейчас играет:**\n\`${trackTitle.slice(0, 100)}\`\n\n🎧 Плеер занят пользователем <@${cache.userId}>`)
      .setFooter({ text: '🎵 Viht Audio System' })
      .setTimestamp();
    
    const row = buildControlRow(true);
    
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    
    // Update session
    if (cache.session) {
      cache.session.currentTrack = trackTitle;
      cache.session.isPlaying = true;
    }
    
    // ⚠️ ВАЖНО: Останавливаем старую музыку перед запуском новой
    // Это предотвращает ситуацию когда юзер нажимает "найти" пока музыка уже играет
    try {
      await musicPlayer.stop(guild).catch(() => null);
      // Даём время на остановку
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('Failed to stop old music:', e.message);
    }
    
    // Start playing
    try {
      await musicPlayer.playNow(guild, voiceChannel, trackUrl, guild.channels.cache.get(cache.session?.channelId) || null, cache.userId).catch(() => {});
    } catch (e) {
      console.warn('playNow error:', e.message);
    }
    
    // Clean up cache
    delete global._playerSearchCache[searchId];
  } catch (e) {
    console.error('handleSearchSelectMenu error:', e);
    await interaction.deferUpdate().catch(() => null);
  }
}

// Handle button choice for search results (fallback when menu fails)
async function handleSearchButton(interaction, client) {
  try {
    const customId = interaction.customId;
    const match = customId.match(/player_search_btn_(.+?)_(\d+)$/);
    
    if (!match) {
      console.warn('[PLAYER] handleSearchButton - customId does not match pattern:', customId);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    const searchId = match[1];
    const selectedIndex = parseInt(match[2]);
    const cache = global._playerSearchCache?.[searchId];
    
    if (!cache) {
      console.warn('[PLAYER] Cache not found for button searchId:', searchId);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    console.log('[PLAYER] 🎵 handleSearchButton - cache:', {
      guildId: cache.guildId,
      voiceChannelId: cache.voiceChannelId,
      userId: cache.userId
    });
    
    const selectedTrack = cache.candidates[selectedIndex];
    
    if (!selectedTrack) {
      console.warn('[PLAYER] Track not found at index:', selectedIndex);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    const trackUrl = selectedTrack.url || selectedTrack.link;
    const trackTitle = selectedTrack.title || 'Unknown';
    
    // Get guild and voice channel
    const guild = await client.guilds.fetch(cache.guildId).catch(() => null);
    if (!guild) {
      console.error('[PLAYER] ❌ Guild not found:', cache.guildId);
      return await interaction.deferUpdate().catch(() => null);
    }
    
    if (!cache.voiceChannelId) {
      console.error('[PLAYER] ❌ voiceChannelId is NULL/UNDEFINED in cache (handleSearchButton)!');
      const embed = buildPlayingEmbed(cache.session || { userId: cache.userId }, '❌ Ошибка: ID канала не найден');
      await interaction.update({ embeds: [embed] }).catch(() => null);
      return;
    }
    
    const voiceChannel = await guild.channels.fetch(cache.voiceChannelId).catch((err) => {
      console.error('[PLAYER] ❌ Failed to fetch voice channel (button):', cache.voiceChannelId, err?.message);
      return null;
    });
    
    if (!voiceChannel) {
      console.error('[PLAYER] ❌ voiceChannel is NULL after fetch (button)');
      const embed = buildPlayingEmbed(cache.session || { userId: cache.userId }, '❌ Голосовой канал не найден');
      await interaction.update({ embeds: [embed] }).catch(() => null);
      return;
    }
    
    // Update the message to show now playing
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🎵 Viht player v.4214')
      .setColor(0x00AA00)
      .setDescription(`**Сейчас играет:**\n\`${trackTitle.slice(0, 100)}\`\n\n🎧 Плеер занят пользователем <@${cache.userId}>`)
      .setFooter({ text: '🎵 Viht Audio System' })
      .setTimestamp();
    
    const row = buildControlRow(true);
    
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    
    // Update session
    if (cache.session) {
      cache.session.currentTrack = trackTitle;
      cache.session.isPlaying = true;
    }
    
    // Start playing
    try {
      await musicPlayer.playNow(guild, voiceChannel, trackUrl, null, cache.userId).catch(() => {});
    } catch (e) {
      console.warn('playNow error:', e.message);
    }
    
    // Clean up cache
    delete global._playerSearchCache[searchId];
  } catch (e) {
    console.error('handleSearchButton error:', e);
    await interaction.deferUpdate().catch(() => null);
  }
}

// Main button handler dispatcher
async function handlePlayerPanelButton(interaction, client) {
  const { customId } = interaction;
  
  try {
    if (customId === 'player_occupy') {
      await handleOccupy(interaction, client);
    } else if (customId === 'player_find_song') {
      await handleFindSong(interaction, client);
    } else if (customId === 'player_add_next') {
      await handleAddNext(interaction, client);
    } else if (customId === 'player_back') {
      await handleBack(interaction, client);
    } else if (customId === 'player_vk_music') {
      const vkHandler = require('../vk/vkMusicHandler');
      await vkHandler.askForVkId(interaction);
    } else if (customId.startsWith('player_search_btn_')) {
      await handleSearchButton(interaction, client);
    }
  } catch (e) {
    console.error('handlePlayerPanelButton error:', e.message);
  }
}

// Main modal handler dispatcher
async function handlePlayerPanelModal(interaction, client) {
  const { customId } = interaction;
  
  try {
    if (customId.startsWith('player_search_modal_')) {
      await handleSearchModalSubmit(interaction, client);
    } else if (customId.startsWith('player_queue_modal_')) {
      await handleQueueModalSubmit(interaction, client);
    }
  } catch (e) {
    console.error('handlePlayerPanelModal error:', e.message);
  }
}

// Handle select menu for search results
async function handlePlayerPanelSelectMenu(interaction, client) {
  const { customId } = interaction;
  
  try {
    if (customId.startsWith('player_search_select_')) {
      await handleSearchSelectMenu(interaction, client);
    }
  } catch (e) {
    console.error('handlePlayerPanelSelectMenu error:', e.message);
  }
}

module.exports = {
  postPlayerMessage,
  buildOccupyEmbed,
  buildOccupyRow,
  buildPlayingEmbed,
  buildControlRow,
  handlePlayerPanelButton,
  handlePlayerPanelModal,
  handlePlayerPanelSelectMenu,
  playerSessions,
  CONTROL_PANEL_CHANNEL_ID
};
