const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Creates main navigation embed for DM menu
 */
function createMainMenuEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🤖 Меню бота Viht')
    .setDescription(`Привет, ${user.username}! 👋\n\nВыбери опцию для управления ботом:`)
    .addFields(
      { name: '🎵 Музыка', value: 'Управление плейлистами, избранным и историей', inline: false },
      { name: '👤 Профиль', value: 'Просмотр статистики и достижений', inline: false },
      { name: '📚 Справка', value: 'Помощь по командам бота', inline: false },
      { name: '⚙️ Сервер', value: 'Информация о сервере и ссылки', inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'Это меню автоматически обновляется каждый час' });
}

/**
 * Creates navigation buttons for main menu
 */
function createMainMenuButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dm_menu_music')
      .setLabel('🎵 Музыка')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm_menu_profile')
      .setLabel('👤 Профиль')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm_menu_help')
      .setLabel('📚 Справка')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('dm_menu_server')
      .setLabel('⚙️ Сервер')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Creates back button row
 */
function createBackButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dm_menu_back')
      .setLabel('← Назад')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Create DM menu for user
 */
async function createUserMenu(client, userId, guildId = null) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;

    const embed = createMainMenuEmbed(user);
    const buttons = createMainMenuButtons();

    const message = await dmChannel.send({
      embeds: [embed],
      components: [buttons]
    }).catch(e => {
      console.error('Failed to send DM menu:', e.message);
      return null;
    });

    return message;
  } catch (err) {
    console.error('createUserMenu error:', err.message);
  }
}

/**
 * Handle DM menu button interactions
 */
async function handleDMMenuButton(interaction) {
  const { customId, user, client } = interaction;

  if (customId === 'dm_menu_back') {
    const embed = createMainMenuEmbed(user);
    const buttons = createMainMenuButtons();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_music') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыка')
      .setDescription('Управление вашей музыкальной библиотекой:')
      .addFields(
        { name: '📋 История', value: 'Последние прослушанные треки', inline: false },
        { name: '❤️ Избранное', value: 'Ваши любимые песни', inline: false },
        { name: '🎼 Плейлисты', value: 'Созданные плейлисты', inline: false }
      )
      .setColor(0x1DB954)
      .setFooter({ text: 'Используйте команду /music_library на сервере для полного управления' });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dm_menu_show_history').setLabel('📋 История').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_menu_show_favorites').setLabel('❤️ Избранное').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_menu_show_playlists').setLabel('🎼 Плейлисты').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('dm_menu_lounge').setLabel('🎧 Lounge').setStyle(ButtonStyle.Secondary)
    );
    const back = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons, back] }).catch(() => {});
    return;
  }

  // Show history in DM
  if (customId === 'dm_menu_show_history') {
    try {
      const musicPlayer = require('./music/player2');
      // find guild context - try fetch a guild where user has history
      const userId = user.id;
      const guilds = Array.from(client.guilds.cache.values());
      let found = false;
      for (const g of guilds) {
        const history = await musicPlayer.getHistory(g.id, userId).catch(() => []);
        if (history && history.length) {
          const { createHistoryEmbed } = require('./music-interface/musicEmbeds');
          const embed = createHistoryEmbed(history);
          await interaction.update({ embeds: [embed], components: [createBackButton()] }).catch(() => {});
          found = true; break;
        }
      }
      if (!found) await safeReply(interaction, { content: 'История не найдена.', ephemeral: true });
    } catch (e) { console.error('dm show history error', e); await safeReply(interaction, { content: 'Ошибка при получении истории.', ephemeral: true }); }
    return;
  }

  // Show favorites in DM
  if (customId === 'dm_menu_show_favorites') {
    try {
      const musicPlayer = require('./music/player2');
      const userId = user.id;
      const guilds = Array.from(client.guilds.cache.values());
      let found = false;
      for (const g of guilds) {
        const fav = await musicPlayer.getFavorites(g.id, userId).catch(() => []);
        if (fav && fav.length) {
          const { createFavoritesEmbed } = require('./music-interface/musicEmbeds');
          const embed = createFavoritesEmbed(fav);
          await interaction.update({ embeds: [embed], components: [createBackButton()] }).catch(() => {});
          found = true; break;
        }
      }
      if (!found) await safeReply(interaction, { content: 'Избранного не найдено.', ephemeral: true });
    } catch (e) { console.error('dm show favorites error', e); await safeReply(interaction, { content: 'Ошибка при получении избранного.', ephemeral: true }); }
    return;
  }

  // Show personal playlists in DM with interactive buttons
  if (customId === 'dm_menu_show_playlists') {
    try {
      const musicPlayer = require('./music/player2');
      const userId = user.id;
      // aggregate playlists across guilds where user has playlists
      const guilds = Array.from(client.guilds.cache.values());
      let any = false;
      for (const g of guilds) {
        const pls = await musicPlayer.getUserPersonalPlaylists(g.id, userId).catch(() => ({}));
        const keys = Object.keys(pls || {});
        if (keys.length) {
          any = true;
          // build embed listing playlists for this guild
          const { createPlaylistsEmbed } = require('./music-interface/musicEmbeds');
          const embed = createPlaylistsEmbed(pls);
          // create up to 5 playlist buttons (per row) with play/add/delete actions for first 4 playlists
          const rows = [];
          let row = new ActionRowBuilder();
          let count = 0;
          for (const id of keys.slice(0, 10)) {
            // for brevity show only play button per playlist in main list, details available after clicking
            row.addComponents(new ButtonBuilder().setCustomId(`dm_pl_open_${g.id}_${id}`).setLabel(pls[id].name.slice(0, 80)).setStyle(ButtonStyle.Primary));
            count++;
            if (count === 5) { rows.push(row); row = new ActionRowBuilder(); count = 0; }
          }
          if (row && row.components && row.components.length) rows.push(row);
          rows.push(createBackButton());
          await interaction.update({ embeds: [embed], components: rows }).catch(() => {});
          break;
        }
      }
      if (!any) await safeReply(interaction, { content: 'У вас нет плейлистов.', ephemeral: true });
    } catch (e) { console.error('dm show playlists error', e); await safeReply(interaction, { content: 'Ошибка при получении плейлистов.', ephemeral: true }); }
    return;
  }

  // Open playlist details (play/add/delete) - expects customId like dm_pl_open_<guildId>_<playlistId>
  if (customId && customId.startsWith('dm_pl_open_')) {
    try {
      const parts = customId.split('_');
      // parts: [dm, pl, open, <guildId>, <playlistId>]
      const guildId = parts[3];
      const playlistId = parts.slice(4).join('_');
      const musicPlayer = require('./music/player2');
      const userId = user.id;
      const pls = await musicPlayer.getUserPersonalPlaylists(guildId, userId).catch(() => ({}));
      const pl = pls[playlistId];
      if (!pl) { await safeReply(interaction, { content: 'Плейлист не найден.', ephemeral: true }); return; }

      const embed = new EmbedBuilder()
        .setTitle(`🎼 Плейлист — ${pl.name}`)
        .setDescription(`Песня(и): ${pl.tracks ? pl.tracks.length : 0}`)
        .setColor(0x1DB954);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dm_pl_play_${guildId}_${playlistId}`).setLabel('▶️ Включить').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dm_pl_add_${guildId}_${playlistId}`).setLabel('➕ Добавить текущую').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dm_pl_delete_${guildId}_${playlistId}`).setLabel('🗑️ Удалить плейлист').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row, createBackButton()] }).catch(() => {});
    } catch (e) { console.error('dm_pl_open error', e); await safeReply(interaction, { content: 'Ошибка при открытии плейлиста.', ephemeral: true }); }
    return;
  }

  // Playlist actions: play/add/delete - customId dm_pl_play_<guildId>_<playlistId> etc.
  if (customId && customId.startsWith('dm_pl_')) {
    try {
      const parts = customId.split('_');
      const action = parts[2];
      const guildId = parts[3];
      const playlistId = parts.slice(4).join('_');
      const musicPlayer = require('./music/player2');

      // find a guild where both user and bot are in same voice channel
      let targetGuild = null;
      let voiceChannel = null;
      for (const g of client.guilds.cache.values()) {
        if (String(g.id) !== String(guildId)) continue; // only the guild for playlist
        const member = await g.members.fetch(user.id).catch(() => null);
        if (!member) continue;
        const vch = member.voice && member.voice.channel ? member.voice.channel : null;
        const botMember = await g.members.fetch(client.user.id).catch(() => null);
        if (vch && botMember && botMember.voice && botMember.voice.channel && botMember.voice.channel.id === vch.id) {
          targetGuild = g; voiceChannel = vch; break;
        }
      }

      if (action === 'play') {
        if (!targetGuild || !voiceChannel) { await safeReply(interaction, { content: '❌ Нужен активный голосовой канал с ботом.', ephemeral: true }); return; }
        await musicPlayer.playPlaylist(targetGuild, voiceChannel, guildId, user.id, playlistId, null).catch(e => console.error('playPlaylist error', e));
        await safeReply(interaction, { content: 'Запущен плейлист.', ephemeral: true });
        return;
      }

      if (action === 'add') {
        // add current track in that guild to playlist
        const current = musicPlayer.getCurrentTrack(guildId);
        if (!current || !current.url) { await safeReply(interaction, { content: 'Нет текущего трека для добавления.', ephemeral: true }); return; }
        const ok = await musicPlayer.addTrackToPlaylist(guildId, user.id, playlistId, { url: current.url, title: current.title }).catch(() => false);
        if (ok) await safeReply(interaction, { content: '✅ Трек добавлен в плейлист.', ephemeral: true }); else await safeReply(interaction, { content: '❌ Не удалось добавить трек.', ephemeral: true });
        return;
      }

      if (action === 'delete') {
        const ok = await musicPlayer.deletePlaylist(guildId, user.id, playlistId).catch(() => false);
        if (ok) await safeReply(interaction, { content: '🗑️ Плейлист удалён.', ephemeral: true }); else await safeReply(interaction, { content: '❌ Не удалось удалить плейлист.', ephemeral: true });
        return;
      }
    } catch (e) { console.error('dm playlist action error', e); await safeReply(interaction, { content: 'Ошибка при обработке действия с плейлистом.', ephemeral: true }); }
    return;
  }

  // Open lounge player in DM
  if (customId === 'dm_menu_lounge') {
    // create lounge player embed with controls
    await openLoungePlayer(user, client, interaction);
    return;
  }

  if (customId === 'dm_menu_profile') {
    const embed = new EmbedBuilder()
      .setTitle('👤 Профиль')
      .setDescription('Информация о вашем профиле:')
      .addFields(
        { name: '📊 Статистика', value: 'Активность, достижения и репутация', inline: false },
        { name: '🏆 Достижения', value: 'Полный список ваших достижений', inline: false }
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'Используйте команду /profile на сервере для полной информации' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Справка')
      .setDescription('Основные команды бота:')
      .addFields(
        { name: '/music', value: 'Управление музыкой на сервере', inline: false },
        { name: '/profile', value: 'Просмотр вашего профиля', inline: false },
        { name: '/music_library', value: 'Управление библиотекой музыки', inline: false },
        { name: '/support', value: 'Создать тикет поддержки', inline: false },
        { name: '/help', value: 'Полный список команд', inline: false }
      )
      .setColor(0x2C3E50)
      .setFooter({ text: 'Для более подробной информации используйте /help на сервере' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_server') {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Сервер')
      .setDescription('Информация о сервере и ссылки:')
      .addFields(
        { name: '🔗 Основной сервер', value: 'https://discord.gg/viht', inline: false },
        { name: '📢 Объявления', value: 'Следите за каналом объявлений для важной информации', inline: false },
        { name: '💬 Чат', value: 'Участвуйте в обсуждениях сообщества', inline: false }
      )
      .setColor(0x7289DA)
      .setFooter({ text: 'Спасибо за использование бота Viht!' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }
}

/**
 * Cleanup old DM menu messages for user
 * Keeps only the most recent menu message
 */
async function cleanupOldMenuMessages(user, client) {
  try {
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;

    // Fetch recent messages from DM channel
    const messages = await dmChannel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return;

    // Find bot's menu messages (with "Меню бота Viht" or DM menu buttons)
    const menuMessages = messages.filter(msg => {
      if (msg.author.id !== client.user.id) return false;
      // Check if message has DM menu buttons or main menu embed
      return msg.components.some(row =>
        row.components.some(comp =>
          comp.customId && comp.customId.startsWith('dm_menu_')
        )
      ) || (msg.embeds && msg.embeds[0] && msg.embeds[0].title === '🤖 Меню бота Viht');
    });

    // Keep only the most recent one
    const sortedMessages = Array.from(menuMessages.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    const messagesToDelete = sortedMessages.slice(1); // Keep first, delete rest

    for (const msg of messagesToDelete) {
      await msg.delete().catch(() => {});
    }

    return sortedMessages.length;
  } catch (err) {
    console.error('cleanupOldMenuMessages error:', err.message);
  }
}

module.exports = {
  createUserMenu,
  handleDMMenuButton,
  cleanupOldMenuMessages,
  createMainMenuEmbed,
  createMainMenuButtons,
  createBackButton
};

// Lounge player: create DM lounge embed and controls
async function openLoungePlayer(user, client, interaction) {
  try {
    const dm = await user.createDM().catch(() => null);
    if (!dm) return;
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🎧 Lounge Player')
      .setDescription('Управление музыкой в личных сообщениях. Текущая песня и очередь отображаются здесь.')
      .setColor(0x1DB954);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dm_lounge_pause').setLabel('⏸ Пауза').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_lounge_skip').setLabel('⏭ Пропустить').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_lounge_repeat').setLabel('🔁 Повтор').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dm_lounge_close').setLabel('✖ Закрыть').setStyle(ButtonStyle.Danger)
    );

    await dm.send({ embeds: [embed], components: [row] }).catch(() => {});
    if (interaction && interaction.deferred) await interaction.update({ content: 'Открыл Lounge Player в ЛС.', embeds: [], components: [] }).catch(() => {});
  } catch (err) {
    console.error('openLoungePlayer error:', err.message);
  }
}

