const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const playerManager = require('./playerManager');
const db = require('../libs/db');

const MUSIC_PANEL_CHANNEL = '1443194196172476636';

async function updateMusicPanel(client) {
  try {
    const channel = await client.channels.fetch(MUSIC_PANEL_CHANNEL).catch(() => null);
    if (!channel) {
      console.warn('[MUSIC] Channel not found:', MUSIC_PANEL_CHANNEL);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыкальный плеер')
      .setDescription('YouTube поиск и управление музыкой')
      .setColor(0x1DB954)
      .addFields(
        { name: '🔍 Поиск', value: 'Найти и добавить песню', inline: true },
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

    if (panelRecord?.messageId && panelRecord?.channelId === MUSIC_PANEL_CHANNEL) {
      try {
        const msg = await channel.messages.fetch(panelRecord.messageId);
        await msg.edit({ embeds: [embed], components: [row1, row2] });
        console.log('[MUSIC] Panel updated:', panelRecord.messageId);
        return;
      } catch (e) {
        console.warn('[MUSIC] Old panel not found, creating new:', e.message);
      }
    }

    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    await db.set('musicPanel', { messageId: msg.id, channelId: MUSIC_PANEL_CHANNEL });
    console.log('[MUSIC] Panel created:', msg.id);
  } catch (e) {
    console.error('[MUSIC] Failed to update panel:', e);
  }
}

async function handleMusicSearchSubmit(interaction) {
  const query = interaction.fields.getTextInputValue('song_query');
  
  if (!query.trim()) {
    await interaction.reply({ content: '❌ Введите название песни', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const results = await playerManager.search(query);
    
    if (results.length === 0) {
      await interaction.editReply('❌ Песни не найдены');
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('music_select')
      .setPlaceholder('Выберите песню')
      .addOptions(results.slice(0, 25).map((song, i) => ({
        label: `${i + 1}. ${song.title.substring(0, 80)}`,
        value: JSON.stringify(song),
        description: song.channel?.substring(0, 100) || 'YouTube'
      })));

    const row = new ActionRowBuilder().addComponents(select);
    await interaction.editReply({ 
      content: '🔍 Результаты поиска:',
      components: [row]
    });

    await db.set(`searchResults_${interaction.user.id}`, { results, expires: Date.now() + 300000 });
  } catch (e) {
    console.error('[MUSIC] Search error:', e);
    await interaction.editReply('❌ Ошибка поиска');
  }
}

async function handleMusicSelect(interaction) {
  if (interaction.customId !== 'music_select') return;

  const selectedValue = interaction.values[0];
  let song;

  try {
    song = JSON.parse(selectedValue);
  } catch (e) {
    await interaction.reply({ content: '❌ Ошибка выбора', ephemeral: true });
    return;
  }

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({ content: '❌ Вы не в голосовом канале', ephemeral: true });
    return;
  }

  playerManager.addToQueue(interaction.guildId, song);
  
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply(`✅ **${song.title}** добавлено в очередь`);

  try {
    await updateMusicPanel(interaction.client);
  } catch (e) {
    console.error('[MUSIC] Panel update error:', e);
  }
}

async function handleMusicButtons(interaction) {
  const { customId } = interaction;

  if (customId === 'music_search') {
    const modal = new ModalBuilder()
      .setCustomId('music_search_modal')
      .setTitle('Поиск песни');

    const input = new TextInputBuilder()
      .setCustomId('song_query')
      .setLabel('Название или артист')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'music_skip') {
    playerManager.skip(interaction.guildId);
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply('⏭️ Трек пропущен');
    return;
  }

  if (customId === 'music_stop') {
    playerManager.stop(interaction.guildId);
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply('⏹️ Плеер остановлен');
    return;
  }

  if (customId === 'music_queue') {
    const queue = playerManager.getQueue(interaction.guildId);
    const nowPlaying = playerManager.getNowPlaying(interaction.guildId);

    let description = '';
    if (nowPlaying) {
      description += `▶️ **Сейчас:** ${nowPlaying.title}\n\n`;
    }

    if (queue.length === 0) {
      description += 'Очередь пуста';
    } else {
      description += queue.slice(0, 10).map((song, i) => `${i + 1}. ${song.title}`).join('\n');
      if (queue.length > 10) description += `\n... и еще ${queue.length - 10}`;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Очередь')
      .setDescription(description)
      .setColor(0x1DB954);

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}

module.exports = {
  updateMusicPanel,
  handleMusicSearchSubmit,
  handleMusicSelect,
  handleMusicButtons
};
