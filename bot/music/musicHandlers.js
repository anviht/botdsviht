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

    if (panelRecord?.messageId) {
      try {
        const msg = await channel.messages.fetch(panelRecord.messageId);
        await msg.edit({ embeds: [embed], components: [row1, row2] });
        console.log('[MUSIC] Panel updated:', panelRecord.messageId);
        return;
      } catch (e) {
        console.warn('[MUSIC] Failed to update existing message:', e.message);
      }
    }

    // Постим новое сообщение
    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    db.set('musicPanel', { messageId: msg.id, channelId: MUSIC_PANEL_CHANNEL });
    console.log('[MUSIC] Panel posted:', msg.id);
  } catch (e) {
    console.error('[MUSIC] Failed to update panel:', e.message);
  }
}

module.exports = {
  updateMusicPanel,
  
  async handleMusicSearch(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'music_search_modal') return;

    try {
      const query = interaction.fields.getTextInputValue('search_query');
      
      console.log('[MUSIC] Searching for:', query);
      const results = await playerManager.search(query);

      if (results.length === 0) {
        await interaction.reply({
          content: '❌ Музыка не найдена',
          ephemeral: true
        });
        return;
      }

      const options = results.slice(0, 5).map((song, i) => ({
        label: song.title.substring(0, 100),
        description: `${song.author} (${song.duration}s)`.substring(0, 100),
        value: `song_${i}`,
        emoji: '🔴'
      }));

      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`music_select_${interaction.user.id}`)
            .setPlaceholder('Выбери песню')
            .addOptions(options)
        );

      // Сохраняем результаты в БД на 5 минут
      const searchKey = `music_search_${interaction.user.id}`;
      await db.ensureReady();
      db.set(searchKey, {
        results,
        timestamp: Date.now(),
        guildId: interaction.guildId
      });

      setTimeout(() => {
        try { db.delete(searchKey); } catch (e) {}
      }, 5 * 60 * 1000);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔍 Результаты поиска')
            .setDescription(`Найдено ${results.length} композиций\n\n**${query}**`)
            .setColor(0x1DB954)
        ],
        components: [row],
        ephemeral: true
      });
    } catch (e) {
      console.error('[MUSIC HANDLER] Search error:', e);
      await interaction.reply({
        content: `❌ Ошибка при поиске: ${e.message}`,
        ephemeral: true
      }).catch(() => {});
    }
  },

  async handleMusicSelect(interaction) {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('music_select_')) return;

    await interaction.deferUpdate();

    try {
      const searchKey = `music_search_${interaction.user.id}`;
      await db.ensureReady();
      const searchData = db.get(searchKey);

      if (!searchData) {
        await interaction.followUp({ content: '❌ Результаты поиска истекли', ephemeral: true });
        return;
      }

      const songIndex = parseInt(interaction.values[0].split('_')[1]);
      const song = searchData.results[songIndex];

      // Проверка: пользователь в голосовом канале?
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.voice.channel) {
        await interaction.followUp({ content: '❌ Ты должен быть в голосовом канале!', ephemeral: true });
        return;
      }

      // Добавляем песню в очередь
      playerManager.addToQueue(interaction.guildId, song);

      // Если это первая песня - начинаем воспроизведение
      const queue = playerManager.getQueue(interaction.guildId);
      if (queue.length === 1) {
        // TODO: Начать воспроизведение
      }

      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Добавлено в очередь')
            .setDescription(`**${song.title}**\n${song.author}`)
            .setThumbnail(song.thumbnail)
            .setColor(0x1DB954)
        ],
        ephemeral: true
      });

      // Обновляем плеер
      await updateMusicPanel(interaction.client);
    } catch (e) {
      console.error('[MUSIC HANDLER] Select error:', e);
    }
  },

  async handleMusicButtons(interaction) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const guildId = interaction.guildId;

    try {
      if (customId === 'music_search') {
        const modal = new ModalBuilder()
          .setCustomId('music_search_modal')
          .setTitle('🔍 Поиск музыки');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('search_query')
              .setLabel('Название или исполнитель')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Например: Linkin Park - In The End')
              .setRequired(true)
          )
        );

        await interaction.showModal(modal);
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      if (customId === 'music_skip') {
        playerManager.skip(guildId);
        await interaction.editReply('⏭️ Трек пропущен');
      }

      if (customId === 'music_stop') {
        playerManager.stop(guildId);
        await interaction.editReply('⏹️ Плеер остановлен');
        await updateMusicPanel(interaction.client);
      }

      if (customId === 'music_queue') {
        const queue = playerManager.getQueue(guildId);
        const nowPlaying = playerManager.nowPlaying.get(guildId);

        if (!nowPlaying && queue.length === 0) {
          await interaction.editReply('❌ Очередь пуста');
          return;
        }

        let queueText = '';
        if (nowPlaying) {
          queueText += `**Сейчас играет:**\n🎵 ${nowPlaying.title}\n\n`;
        }

        if (queue.length > 0) {
          queueText += `**Очередь (${queue.length} композиций):**\n`;
          queue.slice(0, 10).forEach((song, i) => {
            queueText += `${i + 1}. ${song.title.substring(0, 50)}\n`;
          });
          if (queue.length > 10) queueText += `... и ещё ${queue.length - 10} композиций`;
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📋 Очередь')
              .setDescription(queueText || 'Очередь пуста')
              .setColor(0x1DB954)
          ]
        });
      }
    } catch (e) {
      console.error('[MUSIC HANDLER] Button error:', e);
      try {
        await interaction.editReply('❌ Ошибка');
      } catch (e2) {
        await interaction.reply({ content: '❌ Ошибка', ephemeral: true }).catch(() => {});
      }
    }
  }
};
const playerManager = require('./playerManager');
const db = require('../libs/db');

const MUSIC_PANEL_CHANNEL = '1443194196172476636';

async function updateMusicPanel(client) {
  try {
    const channel = await client.channels.fetch(MUSIC_PANEL_CHANNEL).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыкальный плеер')
      .setDescription('YouTube + SoundCloud')
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

    if (panelRecord?.messageId) {
      try {
        const msg = await channel.messages.fetch(panelRecord.messageId);
        await msg.edit({ embeds: [embed], components: [row1, row2] });
        return;
      } catch (e) {}
    }

    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    db.set('musicPanel', { messageId: msg.id, channelId: MUSIC_PANEL_CHANNEL });
  } catch (e) {
    console.error('[PLAYER] Failed to update panel:', e);
  }
}

module.exports = {
  updateMusicPanel,
  async handleMusicSearch(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'music_search_modal') return;

    try {
      const query = interaction.fields.getTextInputValue('search_query');
      
      console.log('[MUSIC] Searching for:', query);
      const results = await playerManager.search(query);

      if (results.length === 0) {
        await interaction.reply({
          content: '❌ Музыка не найдена',
          ephemeral: true
        });
        return;
      }

      const options = results.slice(0, 5).map((song, i) => ({
        label: song.title.substring(0, 100),
        description: `${song.author} (${song.duration}s)`.substring(0, 100),
        value: `song_${i}`,
        emoji: '🔴'
      }));

      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`music_select_${interaction.user.id}`)
            .setPlaceholder('Выбери песню')
            .addOptions(options)
        );

      // Сохраняем результаты в БД на 5 минут
      const searchKey = `music_search_${interaction.user.id}`;
      await db.ensureReady();
      db.set(searchKey, {
        results,
        timestamp: Date.now(),
        guildId: interaction.guildId
      });

      setTimeout(() => {
        try { db.delete(searchKey); } catch (e) {}
      }, 5 * 60 * 1000);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔍 Результаты поиска')
            .setDescription(`Найдено ${results.length} композиций\n\n**${query}**`)
            .setColor(0x1DB954)
        ],
        components: [row],
        ephemeral: true
      });
    } catch (e) {
      console.error('[MUSIC HANDLER] Search error:', e);
      await interaction.reply({
        content: `❌ Ошибка при поиске: ${e.message}`,
        ephemeral: true
      }).catch(() => {});
    }
  },

  async handleMusicSelect(interaction) {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('music_select_')) return;

    await interaction.deferUpdate();

    try {
      const searchKey = `music_search_${interaction.user.id}`;
      await db.ensureReady();
      const searchData = db.get(searchKey);

      if (!searchData) {
        await interaction.followUp({ content: '❌ Результаты поиска истекли', ephemeral: true });
        return;
      }

      const songIndex = parseInt(interaction.values[0].split('_')[1]);
      const song = searchData.results[songIndex];

      // Проверка: пользователь в голосовом канале?
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.voice.channel) {
        await interaction.followUp({ content: '❌ Ты должен быть в голосовом канале!', ephemeral: true });
        return;
      }

      // Добавляем песню в очередь
      playerManager.addToQueue(interaction.guildId, song);

      // Если это первая песня - начинаем воспроизведение
      const queue = playerManager.getQueue(interaction.guildId);
      if (queue.length === 1) {
        await playNext(interaction.client, interaction.guildId, member.voice.channel);
      }

      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Добавлено в очередь')
            .setDescription(`**${song.title}**\n${song.author}`)
            .setThumbnail(song.thumbnail)
            .setColor(0x1DB954)
        ],
        ephemeral: true
      });

      // Обновляем плеер
      await updateMusicPanel(interaction.client);
    } catch (e) {
      console.error('[MUSIC HANDLER] Select error:', e);
    }
  },

  async handleMusicButtons(interaction) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const guildId = interaction.guildId;

    try {
      if (customId === 'music_search') {
        const modal = new ModalBuilder()
          .setCustomId('music_search_modal')
          .setTitle('🔍 Поиск музыки');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('search_query')
              .setLabel('Название или исполнитель')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Например: Linkin Park - In The End')
              .setRequired(true)
          )
        );

        await interaction.showModal(modal);
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      if (customId === 'music_skip') {
        playerManager.skip(guildId);
        await interaction.editReply('⏭️ Трек пропущен');
      }

      if (customId === 'music_stop') {
        playerManager.stop(guildId);
        await interaction.editReply('⏹️ Плеер остановлен');
        await updateMusicPanel(interaction.client);
      }

      if (customId === 'music_queue') {
        const queue = playerManager.getQueue(guildId);
        const nowPlaying = playerManager.nowPlaying.get(guildId);

        if (!nowPlaying && queue.length === 0) {
          await interaction.editReply('❌ Очередь пуста');
          return;
        }

        let queueText = '';
        if (nowPlaying) {
          queueText += `**Сейчас играет:**\n🎵 ${nowPlaying.title}\n\n`;
        }

        if (queue.length > 0) {
          queueText += `**Очередь (${queue.length} композиций):**\n`;
          queue.slice(0, 10).forEach((song, i) => {
            queueText += `${i + 1}. ${song.title.substring(0, 50)}\n`;
          });
          if (queue.length > 10) queueText += `... и ещё ${queue.length - 10} композиций`;
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📋 Очередь')
              .setDescription(queueText || 'Очередь пуста')
              .setColor(0x1DB954)
          ]
        });
      }
    } catch (e) {
      console.error('[MUSIC HANDLER] Button error:', e);
      try {
        await interaction.editReply('❌ Ошибка');
      } catch (e2) {
        await interaction.reply({ content: '❌ Ошибка', ephemeral: true }).catch(() => {});
      }
    }
  }
};

async function playNext(client, guildId, voiceChannel) {
  console.log('[PLAYER] Playing next song in', guildId);
}

async function updateMusicPanel(client) {
  try {
    const channel = await client.channels.fetch(MUSIC_PANEL_CHANNEL).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыкальный плеер')
      .setDescription('YouTube + SoundCloud')
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

    if (panelRecord?.messageId) {
      try {
        const msg = await channel.messages.fetch(panelRecord.messageId);
        await msg.edit({ embeds: [embed], components: [row1, row2] });
        return;
      } catch (e) {}
    }

    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    db.set('musicPanel', { messageId: msg.id, channelId: MUSIC_PANEL_CHANNEL });
  } catch (e) {
    console.error('[PLAYER] Failed to update panel:', e);
  }
}
