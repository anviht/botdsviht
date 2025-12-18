const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const playerManager = require('./playerManager');
const db = require('../libs/db');

const MUSIC_PANEL_CHANNEL = '1443194196172476636';

async function updateMusicPanel(client) {
  try {
    console.log('[MUSIC] updateMusicPanel called');
    const channel = await client.channels.fetch(MUSIC_PANEL_CHANNEL).catch((e) => {
      console.error('[MUSIC] Failed to fetch channel:', e.message);
      return null;
    });
    
    if (!channel) {
      console.error('[MUSIC] Channel not found or not accessible:', MUSIC_PANEL_CHANNEL);
      return;
    }
    
    console.log('[MUSIC] Channel fetched:', channel.name || channel.id);

    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыкальный плеер')
      .setDescription('YouTube поиск')
      .setColor(0x1DB954)
      .addFields(
        { name: '🔍 Поиск', value: 'Найти и включить песню', inline: true },
        { name: '⏭️ Следующая', value: 'Пропустить текущий трек', inline: true },
        { name: '⏹️ Стоп', value: 'Остановить плеер', inline: true },
        { name: '📋 Очередь', value: 'Показать список', inline: true }
      )
      .setFooter({ text: 'Управление музыкой' })
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_search')
        .setLabel('Поиск')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('music_skip')
        .setLabel('Следующая')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('music_stop')
        .setLabel('Стоп')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_queue')
        .setLabel('Очередь')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
    );

    await db.ensureReady();
    const panelRecord = db.get('musicPanel');
    
    console.log('[MUSIC] Panel record from DB:', panelRecord ? `Found messageId: ${panelRecord.messageId}` : 'Not found');

    if (panelRecord?.messageId) {
      try {
        console.log('[MUSIC] Trying to fetch existing message:', panelRecord.messageId);
        const msg = await channel.messages.fetch(panelRecord.messageId);
        console.log('[MUSIC] Existing message found, editing...');
        await msg.edit({ embeds: [embed], components: [row1, row2] });
        console.log('[MUSIC] ✅ Panel updated successfully');
        return;
      } catch (e) { 
        console.warn('[MUSIC] Failed to fetch/edit existing message:', e.message);
      }
    }

    console.log('[MUSIC] Creating new panel message...');
    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    db.set('musicPanel', { messageId: msg.id, channelId: MUSIC_PANEL_CHANNEL });
    console.log('[MUSIC] ✅ Panel posted successfully, messageId:', msg.id);
  } catch (e) {
    console.error('[MUSIC] Failed to update panel:', e.message);
    console.error('[MUSIC] Stack:', e?.stack);
  }
}

function handleMusicSearch(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('music_search_modal')
    .setTitle('Поиск песни');

  const input = new TextInputBuilder()
    .setCustomId('song_query')
    .setLabel('Название или артист')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  interaction.showModal(modal);
}

async function handleMusicSearchSubmit(interaction) {
  const query = interaction.fields.getTextInputValue('song_query');
  
  if (!query.trim()) {
    interaction.reply({ content: ' Введите название песни', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const results = await playerManager.search(query);
    
    if (results.length === 0) {
      interaction.editReply('❌ Песни не найдены');
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('music_select')
      .setPlaceholder('Выберите песню')
      .addOptions(results.slice(0, 25).map((song, i) => ({
        label: `${i + 1}. ${song.title.substring(0, 80)}`,
        value: String(i),
        description: (song.author || song.channel || 'YouTube').substring(0, 100)
      })));

    const row = new ActionRowBuilder().addComponents(select);
    interaction.editReply({ 
      content: '🔍 Результаты поиска:',
      components: [row]
    });

    db.set(`searchResults_${interaction.user.id}`, { results, expires: Date.now() + 300000 });
  } catch (e) {
    console.error('[MUSIC] Search error:', e);
    interaction.editReply('❌ Ошибка поиска');
  }
}

async function handleMusicSelect(interaction) {
  if (interaction.customId !== 'music_select') return;

  const selectedIndex = parseInt(interaction.values[0]);
  
  // Получаем сохранённые результаты поиска
  const searchData = db.get(`searchResults_${interaction.user.id}`);
  
  if (!searchData || !searchData.results || selectedIndex >= searchData.results.length) {
    interaction.reply({ content: '❌ Результаты поиска истекли. Попробуйте снова.', ephemeral: true });
    return;
  }

  const song = searchData.results[selectedIndex];
  
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    interaction.reply({ content: '❌ Вы не в голосовом канале', ephemeral: true });
    return;
  }

  playerManager.addToQueue(interaction.guildId, song);
  
  await interaction.deferReply({ ephemeral: true });
  interaction.editReply(`✅ **${song.title}** добавлено в очередь`);

  try {
    await updateMusicPanel(interaction.client);
  } catch (e) {
    console.error('[MUSIC] Panel update error:', e);
  }
}

async function handleMusicButtons(interaction) {
  const { customId } = interaction;

  if (customId === 'music_search') {
    handleMusicSearch(interaction);
    return;
  }

  if (customId === 'music_skip') {
    playerManager.skip(interaction.guildId);
    await interaction.deferReply({ ephemeral: true });
    interaction.editReply(' Трек пропущен');
    return;
  }

  if (customId === 'music_stop') {
    playerManager.stop(interaction.guildId);
    await interaction.deferReply({ ephemeral: true });
    interaction.editReply(' Плеер остановлен');
    return;
  }

  if (customId === 'music_queue') {
    const queue = playerManager.getQueue(interaction.guildId);
    const nowPlaying = playerManager.getNowPlaying(interaction.guildId);

    let description = '';
    if (nowPlaying) {
      description += ` **Сейчас:** ${nowPlaying.title}\n\n`;
    }

    if (queue.length === 0) {
      description += 'Очередь пуста';
    } else {
      description += queue.slice(0, 10).map((song, i) => `${i + 1}. ${song.title}`).join('\n');
      if (queue.length > 10) description += `\n... и еще ${queue.length - 10}`;
    }

    const embed = new EmbedBuilder()
      .setTitle(' Очередь')
      .setDescription(description)
      .setColor(0x1DB954);

    interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}

module.exports = {
  updateMusicPanel,
  handleMusicSearch,
  handleMusicSearchSubmit,
  handleMusicSelect,
  handleMusicButtons
};
