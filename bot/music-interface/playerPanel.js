const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../libs/db');
const musicPlayer = require('../music/player2');

const CONTROL_PANEL_CHANNEL_ID = '1443194196172476636';

// Store active player sessions: { userId -> { messageId, guildId, voiceChannelId, currentTrack, isPlaying } }
const playerSessions = new Map();

// Build initial "Занять плеер" embed and button
function buildOccupyEmbed() {
  return new EmbedBuilder()
    .setTitle('🎵 Viht player v.4214')
    .setColor(0x2C3E50)
    .setDescription('🎶 Добро пожаловать в музыкальный плеер!\n\n✨ Нажмите кнопку ниже, чтобы занять плеер и начать слушать музыку.')
    .setThumbnail('')
    .setFooter({ text: '🎵 Viht Audio System' })
    .setTimestamp();
}

function buildOccupyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('player_occupy')
      .setLabel('🎵 Занять плеер')
      .setStyle(ButtonStyle.Primary)
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
    const controlChannel = await client.channels.fetch(CONTROL_PANEL_CHANNEL_ID).catch(() => null);
    if (!controlChannel || !controlChannel.isTextBased()) return null;
    
    const embed = buildOccupyEmbed();
    const row = buildOccupyRow();
    
    const msg = await controlChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
    return msg;
  } catch (e) {
    console.error('postPlayerMessage error:', e.message);
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
async function handleFindSong(interaction) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Плеер не занят. Нажмите "Занять плеер"', ephemeral: true }).catch(() => null);
    }
    
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
    
    // Use first result
    const firstResult = searchResults.candidates[0];
    const trackUrl = firstResult.url || firstResult.link;
    const trackTitle = firstResult.title || songQuery;
    
    // Update session
    session.currentTrack = trackTitle;
    session.isPlaying = true;
    
    // Update message - now playing
    const embed = buildPlayingEmbed(session, trackTitle);
    const row = buildControlRow(true);
    
    await interaction.message.edit({ embeds: [embed], components: [row] }).catch(() => null);
    
    // Start playing
    try {
      await musicPlayer.playNow(guild, voiceChannel, trackUrl, interaction.channel, userId).catch(e => {
        console.warn('playNow error:', e.message);
      });
    } catch (e) {
      console.warn('Music playback error:', e.message);
    }
  } catch (e) {
    console.error('handleSearchModalSubmit error:', e.message);
    await interaction.reply({ content: '❌ Ошибка при поиске', ephemeral: true }).catch(() => null);
  }
}

// Handle "Добавить следующую" button
async function handleAddNext(interaction) {
  try {
    const userId = interaction.user.id;
    const session = playerSessions.get(userId);
    
    if (!session) {
      return await interaction.reply({ content: '❌ Плеер не занят', ephemeral: true }).catch(() => null);
    }
    
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

// Handle "Назад" button - stop and release player
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
    
    // Update message back to initial state
    const embed = buildOccupyEmbed();
    const row = buildOccupyRow();
    
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
  } catch (e) {
    console.error('handleBack error:', e.message);
    await interaction.reply({ content: '❌ Ошибка при остановке', ephemeral: true }).catch(() => null);
  }
}

// Main button handler dispatcher
async function handlePlayerPanelButton(interaction, client) {
  const { customId } = interaction;
  
  try {
    if (customId === 'player_occupy') {
      await handleOccupy(interaction, client);
    } else if (customId === 'player_find_song') {
      await handleFindSong(interaction);
    } else if (customId === 'player_add_next') {
      await handleAddNext(interaction);
    } else if (customId === 'player_back') {
      await handleBack(interaction, client);
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

module.exports = {
  postPlayerMessage,
  buildOccupyEmbed,
  buildOccupyRow,
  buildPlayingEmbed,
  buildControlRow,
  handlePlayerPanelButton,
  handlePlayerPanelModal,
  playerSessions,
  CONTROL_PANEL_CHANNEL_ID
};
