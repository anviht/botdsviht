const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const musicPlayer = require('../music/player2');
const { createMusicMenuEmbed, createRadioListEmbed, createNowPlayingEmbed, createPlayerControlsEmbed } = require('./musicEmbeds');

const radiosPath = path.join(__dirname, '..', 'music', 'radios.json');
const radios = JSON.parse(fs.readFileSync(radiosPath, 'utf-8'));

const activeRadios = new Map();
const db = require('../libs/db');

// Status channel where the bot posts who occupies the music bot
const STATUS_CHANNEL_ID = '1441896031531827202';
const ADMIN_ROLE_ID = '1436485697392607303';

// ===== HELPERS =====
async function _getControlRecForGuild(guildId) {
  try {
    const key = `musicControl_${guildId}`;
    return db.get(key) || null;
  } catch (e) { return null; }
}

async function _saveControlMessageForGuild(guildId, channelId, messageId, owner = null) {
  try {
    const key = `musicControl_${guildId}`;
    const existing = db.get(key) || {};
    const rec = { channelId, messageId };
    if (existing && existing.owner) rec.owner = existing.owner;
    if (owner) rec.owner = owner;
    await db.set(key, rec);
  } catch (e) { console.error('Failed to save control message to DB', e); }
}

async function _setMusicOwner(guildId, ownerId) {
  try {
    const key = `musicControl_${guildId}`;
    const existing = db.get(key) || {};
    existing.owner = ownerId ? String(ownerId) : null;
    await db.set(key, existing);
  } catch (e) { console.error('Failed to set music owner in DB', e); }
}

async function _clearMusicOwner(guildId) {
  try {
    const key = `musicControl_${guildId}`;
    const existing = db.get(key) || {};
    delete existing.owner;
    await db.set(key, existing);
  } catch (e) { console.error('Failed to clear music owner in DB', e); }
}

// Update the public status message in STATUS_CHANNEL_ID about current owner
async function _updateStatusChannel(guildId, client) {
  try {
    if (!client) return;
    const controlKey = `musicControl_${guildId}`;
    const controlRec = db.get(controlKey) || {};
    const ownerId = controlRec.owner || null;

    const key = `musicStatus_${guildId}`;
    const rec = db.get(key) || {};

    const ch = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    let embed;
    let components = [];
    if (ownerId) {
      embed = new EmbedBuilder().setTitle('🎛️ Статус: Плеер занят').setColor(0xE74C3C)
        .setDescription(`Плеер сейчас занят пользователем <@${ownerId}>.`)
        .addFields({ name: 'Действия', value: 'Админ может отключить плеер ниже.' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`music_admin_release_${guildId}_${ownerId}`).setLabel('Отключить (админ)').setStyle(ButtonStyle.Danger)
      );
      components = [row];
    } else {
      embed = new EmbedBuilder().setTitle('🎛️ Статус: Плеер свободен').setColor(0x2ECC71)
        .setDescription('Плеер свободен — нажмите «Начать пользоваться» в панели управления, чтобы занять его.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary)
      );
      components = [row];
    }

    if (rec && rec.messageId) {
      const old = await ch.messages.fetch(rec.messageId).catch(() => null);
      if (old) {
        await old.edit({ embeds: [embed], components }).catch(() => null);
        return;
      }
    }

    const msg = await ch.send({ embeds: [embed], components }).catch(() => null);
    if (msg) {
      await db.set(key, { channelId: ch.id, messageId: msg.id });
    }
  } catch (e) { console.error('_updateStatusChannel error', e); }
}

// Update the MAIN control message in DB, not interaction message
async function _updateMainControlMessage(guildId, client, embeds, components) {
  try {
    const key = `musicControl_${guildId}`;
    const rec = db.get(key);
    if (!rec || !rec.channelId || !rec.messageId) {
      console.warn('No control message found for guild', guildId);
      return false;
    }
    const ch = await client.channels.fetch(rec.channelId).catch(() => null);
    if (!ch || !ch.messages) return false;
    const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
    if (!msg) return false;
    await msg.edit({ embeds, components }).catch(() => null);
    return true;
  } catch (e) {
    console.error('_updateMainControlMessage error', e);
    return false;
  }
}

// Ensure there is a music control message for the guild/channel with a single register button
async function ensureMusicControlPanel(channel) {
  try {
    if (!channel || !channel.guild) return;
    const guildId = channel.guild.id;
    const key = `musicControl_${guildId}`;
    const rec = db.get(key);
    const embed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
    if (!rec || !rec.channelId || !rec.messageId) {
      const posted = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (posted) await db.set(key, { channelId: channel.id, messageId: posted.id }).catch(()=>{});
      return;
    }
    const ch = channel;
    const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
    if (!msg) {
      const posted = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (posted) await db.set(key, { channelId: channel.id, messageId: posted.id }).catch(()=>{});
    } else {
      if (!rec.owner) {
        await msg.edit({ embeds: [embed], components: [row] }).catch(()=>{});
      }
    }
  } catch (e) { console.error('ensureMusicControlPanel error', e); }
}

// ===== MAIN HANDLER =====
async function handleMusicButton(interaction) {
  const { customId, user, member, guild, client } = interaction;
  
  // Load control record and determine owner
  let panelRec = null;
  try { panelRec = guild && guild.id ? (db.get(`musicControl_${guild.id}`) || null) : null; } catch (e) { panelRec = null; }
  const ownerId = panelRec && panelRec.owner ? String(panelRec.owner) : null;

  try {
    // ===== REGISTRATION =====
    if (customId === 'music_register') {
      try {
        if (!guild) return await interaction.reply({ content: '❌ Ошибка: не удалось определить сервер.', ephemeral: true });
        const rec = await _getControlRecForGuild(guild.id);
        if (rec && rec.owner) {
          return await interaction.reply({ content: '❌ Плеер уже занят другим пользователем.', ephemeral: true });
        }
        // Set owner
        await _setMusicOwner(guild.id, user.id);
        // Update public status message about owner
        try { await _updateStatusChannel(guild.id, client); } catch (e) {}
        // Show owner menu
        const embed = createMusicMenuEmbed();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('music_release').setLabel('Остановить бота').setStyle(ButtonStyle.Danger)
        );
        // Update main control message - try to update stored message
        let updated = await _updateMainControlMessage(guild.id, client, [embed], [row]);
        
        // If update failed (no stored message), try to use the interaction message instead
        if (!updated && interaction.message && interaction.message.id && interaction.channel) {
          try {
            await interaction.message.edit({ embeds: [embed], components: [row] });
            await _saveControlMessageForGuild(guild.id, interaction.channel.id, interaction.message.id, user.id);
            updated = true;
          } catch (e) { console.warn('Failed to edit interaction message during register', e); }
        }
        
        if (updated) {
          return await interaction.reply({ content: '✅ Вы зарегистрированы как владелец. Управление доступно.', ephemeral: true });
        } else {
          return await interaction.reply({ content: '✅ Зарегистрированы, но не удалось обновить панель.', ephemeral: true });
        }
      } catch (e) {
        console.error('music_register error', e);
        try { await interaction.reply({ content: '❌ Ошибка регистрации.', ephemeral: true }); } catch (e2) {}
      }
      return;
    }

    // ===== ADMIN RELEASE (from status message) =====
    if (customId && customId.startsWith('music_admin_release_')) {
      try {
        // customId format: music_admin_release_<guildId>_<ownerId>
        const parts = customId.split('_');
        const targetGuildId = parts[3];
        const targetOwnerId = parts[4] || null;
        // Only allow admins
        const memberObj = member || (guild ? await guild.members.fetch(user.id).catch(() => null) : null);
        const isAdmin = memberObj && memberObj.roles && memberObj.roles.cache && memberObj.roles.cache.has(ADMIN_ROLE_ID);
        if (!isAdmin) return await interaction.reply({ content: 'У вас нет прав для этой операции.', ephemeral: true });

        // Stop music and clear owner
        try { await musicPlayer.stop(guild); } catch (e) { console.warn('admin_release: stop failed', e); }
        await _clearMusicOwner(guild.id);
        await _updateStatusChannel(guild.id, client).catch(()=>{});
        const embed = new EmbedBuilder().setTitle('⏹️ Плеер отключён администратором').setColor(0xE74C3C).setDescription(`Плеер принудительно отключён администратором <@${user.id}>. Ранее был занят пользователем <@${targetOwnerId}>.`);
        // Reset main control message to register view
        const registerEmbed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
        const registerRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
        await _updateMainControlMessage(guild.id, client, [registerEmbed], [registerRow]);
        try { await interaction.reply({ embeds: [embed] }); } catch (e) {}
      } catch (e) { console.error('music_admin_release handler error', e); try { await interaction.reply({ content: 'Ошибка при выполнении админ‑отключения.', ephemeral: true }); } catch(ignore){} }
      return;
    }

    // ===== CHECK OWNER FOR ALL OTHER ACTIONS =====
    // If no owner, user must register first
    if (!ownerId) {
      try { await interaction.reply({ content: '🔒 Плеер свободен. Нажмите «Начать пользоваться», чтобы получить доступ.', ephemeral: true }); } catch (e) {}
      return;
    }

    // If owner exists but caller is not owner, deny access
    if (ownerId !== String(user.id)) {
      try { await interaction.reply({ content: '❌ Плеер занят другим пользователем. Дождитесь освобождения.', ephemeral: true }); } catch (e) {}
      return;
    }

    // ===== OWNER-ONLY ACTIONS =====

    // RELEASE/STOP
    if (customId === 'music_release') {
      try {
        try { await musicPlayer.stop(guild); } catch (e) { console.warn('music_release: stop failed', e); }
        await _clearMusicOwner(guild.id);
        try { await _updateStatusChannel(guild.id, client); } catch (e) {}
        
        // Reset main message to register view
        const embed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
        await _updateMainControlMessage(guild.id, client, [embed], [row]);
        
        return await interaction.reply({ content: '⏹️ Вы остановили бота и освободили доступ.', ephemeral: true });
      } catch (e) {
        console.error('music_release error', e);
        try { await interaction.reply({ content: '❌ Ошибка при остановке.', ephemeral: true }); } catch (e2) {}
      }
      return;
    }

    // MAIN MENU
    if (customId === 'music_menu') {
      const embed = createMusicMenuEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_release').setLabel('Остановить бота').setStyle(ButtonStyle.Danger)
      );
      await _updateMainControlMessage(guild.id, client, [embed], [row]);
      try { await interaction.reply({ content: '✅ Меню обновлено.', ephemeral: true }); } catch (e) {}
      return;
    }

    // RADIO MENU
    if (customId === 'music_radio') {
      const embed = createRadioListEmbed();
      const radioButtons = radios.map((radio) =>
        new ButtonBuilder()
          .setCustomId(`radio_play_${radio.id}`)
          .setLabel(radio.label.substring(0, 80))
          .setStyle(ButtonStyle.Success)
      );
      const rows = [];
      for (let i = 0; i < radioButtons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(radioButtons.slice(i, i + 5)));
      }
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_menu').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      ));
      await _updateMainControlMessage(guild.id, client, [embed], rows);
      try { await interaction.reply({ content: '✅ Список радио обновлен.', ephemeral: true }); } catch (e) {}
      return;
    }

    // PLAY RADIO STATION
    if (customId.startsWith('radio_play_')) {
      const radioId = customId.replace('radio_play_', '');
      const radio = radios.find(r => r.id === radioId);
      
      if (!radio) {
        const embed = new EmbedBuilder().setTitle('❌ Радиостанция не найдена').setColor(0xFF5252);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
        await _updateMainControlMessage(guild.id, client, [embed], [row]);
        try { await interaction.reply({ content: '❌ Станция не найдена.', ephemeral: true }); } catch (e) {}
        return;
      }

      let memberRef = member;
      if ((!memberRef || !memberRef.voice || !memberRef.voice.channel) && guild) {
        try { memberRef = await guild.members.fetch(user.id).catch(() => null); } catch (e) { memberRef = null; }
      }
      const voiceChannel = memberRef?.voice?.channel;
      if (!voiceChannel) {
        const embed = new EmbedBuilder().setTitle('❌ Не подключены к голосовому каналу').setColor(0xFF5252);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
        await _updateMainControlMessage(guild.id, client, [embed], [row]);
        try { await interaction.reply({ content: '❌ Вы не в голосовом канале.', ephemeral: true }); } catch (e) {}
        return;
      }

      try {
        const radioStream = { url: radio.url };
        const ok = await musicPlayer.playRadio(guild, voiceChannel, radioStream, interaction.channel, user.id);
        if (!ok) {
          const embed = new EmbedBuilder().setTitle('❌ Не удалось подключиться').setColor(0xFF5252).setDescription('Попробуйте ещё раз');
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
          await _updateMainControlMessage(guild.id, client, [embed], [row]);
          try { await interaction.reply({ content: '❌ Ошибка подключения.', ephemeral: true }); } catch (e) {}
          return;
        }

        activeRadios.set(guild.id, { radio, userId: user.id });

        const embed = createPlayerControlsEmbed(radio.label);
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_next_station').setLabel('📻 Другая станция').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
        );
        await _updateMainControlMessage(guild.id, client, [embed], [controlRow]);
        try { await interaction.reply({ content: `▶️ Включаю ${radio.label}...`, ephemeral: true }); } catch (e) {}
      } catch (err) {
        console.error('Error playing radio:', err);
        const embed = new EmbedBuilder().setTitle('❌ Ошибка при подключении').setColor(0xFF5252).setDescription(err && err.message ? String(err.message).slice(0, 200) : 'Ошибка');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
        await _updateMainControlMessage(guild.id, client, [embed], [row]);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch (e) {}
      }
      return;
    }

    // VOLUME CONTROLS
    if (customId === 'radio_volume_up') {
      try {
        const newVol = await musicPlayer.changeVolume(guild, 0.1);
        const state = activeRadios.get(guild.id) || {};
        const embed = createPlayerControlsEmbed(state.radio?.label || 'Радио');
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_next_station').setLabel('📻 Другая станция').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
        );
        await _updateMainControlMessage(guild.id, client, [embed], [controlRow]);
        try { await interaction.reply({ content: `🔊 Громкость: ${Math.round(newVol * 100)}%`, ephemeral: true }); } catch (e) {}
      } catch (err) {
        try { await interaction.reply({ content: '❌ Ошибка при изменении громкости', ephemeral: true }); } catch (e) {}
      }
      return;
    }

    if (customId === 'radio_volume_down') {
      try {
        const newVol = await musicPlayer.changeVolume(guild, -0.1);
        const state = activeRadios.get(guild.id) || {};
        const embed = createPlayerControlsEmbed(state.radio?.label || 'Радио');
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_next_station').setLabel('📻 Другая станция').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
        );
        await _updateMainControlMessage(guild.id, client, [embed], [controlRow]);
        try { await interaction.reply({ content: `🔉 Громкость: ${Math.round(newVol * 100)}%`, ephemeral: true }); } catch (e) {}
      } catch (err) {
        try { await interaction.reply({ content: '❌ Ошибка при изменении громкости', ephemeral: true }); } catch (e) {}
      }
      return;
    }

    // SWITCH STATION
    if (customId === 'radio_next_station') {
      const embed = createRadioListEmbed();
      const radioButtons = radios.map((radio) =>
        new ButtonBuilder()
          .setCustomId(`radio_play_${radio.id}`)
          .setLabel(radio.label.substring(0, 80))
          .setStyle(ButtonStyle.Success)
      );
      const rows = [];
      for (let i = 0; i < radioButtons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(radioButtons.slice(i, i + 5)));
      }
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_menu').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      ));
      await _updateMainControlMessage(guild.id, client, [embed], rows);
      try { await interaction.reply({ content: '📻 Выберите станцию.', ephemeral: true }); } catch (e) {}
      return;
    }

    // RADIO STOP
    if (customId === 'radio_stop') {
      try {
        await musicPlayer.stop(guild);
        activeRadios.delete(guild.id);
        await _clearMusicOwner(guild.id).catch(()=>{});
        try { await _updateStatusChannel(guild.id, client); } catch (e) {}
        const registerEmbed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
        const registerRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
        await _updateMainControlMessage(guild.id, client, [registerEmbed], [registerRow]);
        try { await interaction.reply({ content: '⏹️ Радио остановлено. Доступ освобожден.', ephemeral: true }); } catch (e) {}
      } catch (err) {
        try { await interaction.reply({ content: '❌ Ошибка при остановке', ephemeral: true }); } catch (e) {}
      }
      return;
    }

    // CUSTOM MUSIC MENU
    if (customId === 'music_own') {
      const embed = new EmbedBuilder()
        .setTitle('🎵 Своя музыка')
        .setColor(0x7289DA)
        .setDescription('Воспроизведение музыки по названию.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_custom_search').setLabel('🔎 Найти и играть').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music_custom_queue').setLabel('➕ Добавить в очередь').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_menu').setLabel('← В меню').setStyle(ButtonStyle.Danger)
      );
      await _updateMainControlMessage(guild.id, client, [embed], [row]);
      try { await interaction.reply({ content: '✅ Меню музыки обновлено.', ephemeral: true }); } catch (e) {}
      return;
    }

    // CUSTOM MUSIC SEARCH MODAL
    if (customId === 'music_custom_search') {
      const modal = new ModalBuilder()
        .setCustomId('music_search_modal')
        .setTitle('🔎 Найти песню');
      const songInput = new TextInputBuilder()
        .setCustomId('song_name')
        .setLabel('Название песни (исполнитель)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(songInput));
      await interaction.showModal(modal);
      return;
    }

    // CUSTOM MUSIC QUEUE MODAL
    if (customId === 'music_custom_queue') {
      const modal = new ModalBuilder()
        .setCustomId('music_queue_modal')
        .setTitle('➕ Добавить в очередь');
      const songInput = new TextInputBuilder()
        .setCustomId('song_name_queue')
        .setLabel('Название песни (исполнитель)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(songInput));
      await interaction.showModal(modal);
      return;
    }

    // BACK TO MAIN MENU
    if (customId === 'music_back') {
      const embed = createMusicMenuEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_release').setLabel('Остановить бота').setStyle(ButtonStyle.Danger)
      );
      await _updateMainControlMessage(guild.id, client, [embed], [row]);
      try { await interaction.reply({ content: '✅ Вернулись в меню.', ephemeral: true }); } catch (e) {}
      return;
    }

    if (customId === 'music_link') {
      try { await interaction.reply({ content: '🔨 **Ссылка** - в разработке', ephemeral: true }); } catch (e) {}
      return;
    }

  } catch (err) {
    console.error('Music button handler error:', err);
    try {
      await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    } catch (e) {
      console.error('Failed to reply to interaction:', e);
    }
  }
}

function getMusicButtonHandler() {
  return handleMusicButton;
}

module.exports = {
  getMusicButtonHandler,
  handleMusicButton,
  ensureMusicControlPanel
};
