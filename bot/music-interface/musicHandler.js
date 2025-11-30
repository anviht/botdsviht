const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const musicPlayer = require('../music/player2');
const { createMusicMenuEmbed, createRadioListEmbed, createNowPlayingEmbed, createPlayerControlsEmbed } = require('./musicEmbeds');

// Load radios
const radiosPath = path.join(__dirname, '..', 'music', 'radios.json');
const radios = JSON.parse(fs.readFileSync(radiosPath, 'utf-8'));

// Store active radio states per guild
const activeRadios = new Map();
const db = require('../libs/db');

// Helpers for storing control message + owner
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

// Ensure there is a music control message for the guild/channel with a single register button
async function ensureMusicControlPanel(channel) {
  try {
    if (!channel || !channel.guild) return;
    const guildId = channel.guild.id;
    const key = `musicControl_${guildId}`;
    const rec = db.get(key);
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const embed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
    if (!rec || !rec.channelId || !rec.messageId) {
      const posted = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (posted) await db.set(key, { channelId: channel.id, messageId: posted.id }).catch(()=>{});
      return;
    }
    // Try to fetch and update existing message; if missing, repost
    const ch = channel;
    const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
    if (!msg) {
      const posted = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (posted) await db.set(key, { channelId: channel.id, messageId: posted.id }).catch(()=>{});
    } else {
      // If an owner exists, keep message as-is (owner manages it); otherwise ensure it shows register button
      if (!rec.owner) {
        await msg.edit({ embeds: [embed], components: [row] }).catch(()=>{});
      }
    }
  } catch (e) { console.error('ensureMusicControlPanel error', e); }
}

async function _saveControlMessageForGuild(guildId, channelId, messageId) {
  try {
    const key = `musicControl_${guildId}`;
    await db.set(key, { channelId, messageId });
  } catch (e) { console.error('Failed to save control message to DB', e); }
}

async function handleMusicButton(interaction) {
  const { customId, user, member, guild, client } = interaction;
  // Load control record and determine owner (if any) for this guild
  let panelRec = null;
  try { panelRec = guild && guild.id ? (db.get(`musicControl_${guild.id}`) || null) : null; } catch (e) { panelRec = null; }
  const ownerId = panelRec && panelRec.owner ? String(panelRec.owner) : null;
  try {
    // Main music menu - show options
    if (customId === 'music_menu') {
      // Enforce registration/ownership: if there is an owner and caller is not owner, deny
      if (ownerId && ownerId !== String(user.id)) {
        try { await interaction.reply({ content: '❌ БОТ аудио занят другим пользователем', ephemeral: true }); } catch (e) { /* ignore */ }
        return;
      }
      // If no owner yet, instruct to press register instead
      if (!ownerId) {
        try { await interaction.reply({ content: '🔒 Плеер свободен. Нажмите «Начать пользоваться» в панели управления, чтобы получить доступ.', ephemeral: true }); } catch (e) {}
        return;
      }
      // Update the existing control message instead of sending new replies
      const embed = createMusicMenuEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
        try { 
        await interaction.update({ embeds: [embed], components: [row] }); 
        if (guild && guild.id && interaction.message && interaction.message.id) {
          await _saveControlMessageForGuild(guild.id, interaction.channel.id, interaction.message.id);
        }
      } catch (e) { 
        await interaction.editReply({ embeds: [embed], components: [row] }).catch(()=>{}); 
        if (guild && guild.id && interaction.message && interaction.message.id) {
          await _saveControlMessageForGuild(guild.id, interaction.channel.id, interaction.message.id).catch(()=>{});
        }
      }
      return;
    }

    // Registration: first user to press becomes owner
    if (customId === 'music_register') {
      try {
        if (!guild) return await interaction.reply({ content: '❌ Ошибка: не удалось определить сервер.', ephemeral: true });
        const rec = await _getControlRecForGuild(guild.id);
        if (rec && rec.owner) {
          return await interaction.reply({ content: '❌ Плеер уже занят другим пользователем.', ephemeral: true });
        }
        // Set owner and show music menu to owner by editing the control message
        await _setMusicOwner(guild.id, user.id);
        // Update control message to owner view (music menu)
        const embed = createMusicMenuEmbed();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('music_release').setLabel('Остановить бота').setStyle(ButtonStyle.Danger)
        );
        // Edit stored control message if present
        if (rec && rec.channelId && rec.messageId) {
          try {
            const ch = await client.channels.fetch(rec.channelId).catch(() => null);
            if (ch && ch.messages) {
              const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
              if (msg) {
                await msg.edit({ embeds: [embed], components: [row] }).catch(() => null);
                await _saveControlMessageForGuild(guild.id, rec.channelId, rec.messageId, user.id).catch(() => null);
                return await interaction.reply({ content: '✅ Вы зарегистрированы как владелец аудио. Управление доступно.', ephemeral: true });
              }
            }
          } catch (e) { /* ignore */ }
        }
        // Fallback: reply that registration succeeded but control message couldn't be updated
        return await interaction.reply({ content: '✅ Вы зарегистрированы как владелец аудио. Но не удалось обновить панель (возможно сообщение удалено).', ephemeral: true });
      } catch (e) {
        console.error('music_register error', e);
        try { await interaction.reply({ content: '❌ Ошибка регистрации.', ephemeral: true }); } catch (e2) {}
      }
      return;
    }

    // Release ownership / stop bot (only owner)
    if (customId === 'music_release') {
      try {
        if (!guild) return await interaction.reply({ content: '❌ Ошибка: не удалось определить сервер.', ephemeral: true });
        const rec = await _getControlRecForGuild(guild.id);
        const owner = rec && rec.owner ? String(rec.owner) : null;
        if (!owner || owner !== String(user.id)) return await interaction.reply({ content: '❌ Только владелец может остановить бота.', ephemeral: true });
        // Stop playback and clear owner
        try { await musicPlayer.stop(guild); } catch (e) { console.warn('music_release: stop failed', e); }
        await _clearMusicOwner(guild.id);
        // Update control message back to initial register view
        if (rec && rec.channelId && rec.messageId) {
          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
          const embed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
          try {
            const ch = await client.channels.fetch(rec.channelId).catch(() => null);
            if (ch && ch.messages) {
              const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
              if (msg) await msg.edit({ embeds: [embed], components: [row] }).catch(() => null);
            }
          } catch (e) { /* ignore */ }
        }
        return await interaction.reply({ content: '⏹️ Вы остановили бота и освободили доступ.', ephemeral: true });
      } catch (e) {
        console.error('music_release error', e);
        try { await interaction.reply({ content: '❌ Ошибка при остановке.', ephemeral: true }); } catch (e2) {}
      }
      return;
    }

    // Show radio list
    if (customId === 'music_radio') {
      const embed = createRadioListEmbed();
      const radioButtons = radios.map((radio, idx) =>
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
      try { await interaction.update({ embeds: [embed], components: rows }); } catch (e) { await interaction.editReply({ embeds: [embed], components: rows }).catch(()=>{}); }
      return;
    }

    // Play radio station
    if (customId.startsWith('radio_play_')) {
      // User clicked a station — update the same control message with status
      
      const radioId = customId.replace('radio_play_', '');
      const radio = radios.find(r => r.id === radioId);
      
      if (!radio) {
        const embed = new EmbedBuilder().setTitle('❌ Радиостанция не найдена').setColor(0xFF5252);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
        try { await interaction.update({ embeds: [embed], components: [row] }); } catch (e) { await interaction.editReply({ embeds: [embed], components: [row] }).catch(()=>{}); }
        return;
      }

      // Get or create voice channel connection — ensure member is fetched so voice state is available
      let memberRef = member;
      if ((!memberRef || !memberRef.voice || !memberRef.voice.channel) && guild) {
        try { memberRef = await guild.members.fetch(user.id).catch(() => null); } catch (e) { memberRef = null; }
      }
      const voiceChannel = memberRef?.voice?.channel;
      if (!voiceChannel) {
        // Try to update the central control message with the error; fall back to ephemeral reply
        const panelKey = `musicControl_${guild && guild.id ? guild.id : 'unknown'}`;
        const panelRec = db.get(panelKey);
        let updated = false;
        if (panelRec && panelRec.channelId && panelRec.messageId) {
          try {
            const ch = await interaction.client.channels.fetch(panelRec.channelId).catch(() => null);
            if (ch && ch.messages) {
              const ctrl = await ch.messages.fetch(panelRec.messageId).catch(() => null);
              if (ctrl) {
                await ctrl.edit({ content: '❌ Ты не подключен к голосовому каналу', embeds: [], components: [] }).catch(() => {});
                updated = true;
              }
            }
          } catch (e) { /* ignore */ }
        }
        if (!updated) {
          try { await interaction.reply({ content: '❌ Ты не подключен к голосовому каналу', ephemeral: true }); } catch (e) { try { await interaction.followUp({ content: '❌ Ты не подключен к голосовому каналу', ephemeral: true }); } catch (e2) {} }
        }
        return;
      }

      try {
        // Play radio stream directly (bypass YouTube search)
        const radioStream = { url: radio.url };
        const ok = await musicPlayer.playRadio(guild, voiceChannel, radioStream, interaction.channel, user.id);
        if (!ok) {
          const embed = new EmbedBuilder().setTitle('❌ Не удалось подключиться к радиостанции').setColor(0xFF5252).setDescription('Попробуйте ещё раз');
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
          try { await interaction.update({ embeds: [embed], components: [row] }); } catch (e) { await interaction.editReply({ embeds: [embed], components: [row] }).catch(()=>{}); }
          return;
        }

        // Store active radio info
        activeRadios.set(guild.id, { radio, userId: user.id });

        // Show now playing embed with controls (update same message)
        const embed = createPlayerControlsEmbed(radio.label);
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_next_station').setLabel('📻 Другая станция').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
        );
        try { await interaction.update({ embeds: [embed], components: [controlRow] }); } catch (e) { await interaction.editReply({ embeds: [embed], components: [controlRow] }).catch(()=>{}); }
      } catch (err) {
        console.error('Error playing radio:', err);
        const embed = new EmbedBuilder().setTitle('❌ Ошибка при подключении к радио').setColor(0xFF5252).setDescription(err && err.message ? String(err.message).slice(0,200) : 'Ошибка');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_radio').setLabel('← Назад').setStyle(ButtonStyle.Danger));
        try { await interaction.update({ embeds: [embed], components: [row] }); } catch (e) { await interaction.editReply({ embeds: [embed], components: [row] }).catch(()=>{}); }
      }
      return;
    }

    // Volume controls
    if (customId === 'radio_volume_up') {
      try {
        const newVol = await musicPlayer.changeVolume(guild, 0.1);
        await interaction.update({ content: `🔊 Громкость: ${Math.round(newVol * 100)}%` }).catch(()=>{});
      } catch (err) {
        await interaction.update({ content: '❌ Ошибка при изменении громкости' }).catch(()=>{});
      }
      return;
    }

    if (customId === 'radio_volume_down') {
      try {
        const newVol = await musicPlayer.changeVolume(guild, -0.1);
        await interaction.update({ content: `🔉 Громкость: ${Math.round(newVol * 100)}%` }).catch(()=>{});
      } catch (err) {
        await interaction.update({ content: '❌ Ошибка при изменении громкости' }).catch(()=>{});
      }
      return;
    }

    // Switch station (go back to radio list)
    if (customId === 'radio_next_station') {
      const embed = createRadioListEmbed();
      const radioButtons = radios.map((radio, idx) =>
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
      try { await interaction.update({ embeds: [embed], components: rows }); } catch (e) { await interaction.editReply({ embeds: [embed], components: rows }).catch(()=>{}); }
      return;
    }

    // Stop radio
    if (customId === 'radio_stop') {
      try {
        await musicPlayer.stop(guild);
        activeRadios.delete(guild.id);
        // Clear owner and reset the single control panel back to registration state
        await _clearMusicOwner(guild.id).catch(()=>{});
        const registerEmbed = new EmbedBuilder().setTitle('🎵 Управление аудио').setColor(0x2C3E50).setDescription('Нажмите кнопку, чтобы начать пользоваться ботом (первый нажимает — становится владельцем плеера).');
        const registerRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_register').setLabel('Начать пользоваться').setStyle(ButtonStyle.Primary));
        // Try to update stored control message
        try {
          const panelKey = `musicControl_${guild.id}`;
          const rec = db.get(panelKey);
          if (rec && rec.channelId && rec.messageId) {
            const ch = await interaction.client.channels.fetch(rec.channelId).catch(()=>null);
            if (ch && ch.messages) {
              const msg = await ch.messages.fetch(rec.messageId).catch(()=>null);
              if (msg) {
                await msg.edit({ embeds: [registerEmbed], components: [registerRow] }).catch(()=>{});
                // ensure DB record has no owner
                await db.set(panelKey, { channelId: rec.channelId, messageId: rec.messageId }).catch(()=>{});
                // Acknowledge interaction by editing the same message if possible
                try { await interaction.update({ embeds: [registerEmbed], components: [registerRow] }); return; } catch (e) { /* fallback below */ }
              }
            }
          }
        } catch (e) { /* ignore */ }
        // Fallback: update the interaction message to show stopped info but also include register button
        try { await interaction.update({ embeds: [registerEmbed], components: [registerRow] }); } catch (e) { await interaction.editReply({ embeds: [registerEmbed], components: [registerRow] }).catch(()=>{}); }
      } catch (err) {
        await interaction.update({ content: '❌ Ошибка при остановке плеера' }).catch(()=>{});
      }
      return;
    }

    // Custom music - show search and queue options
    if (customId === 'music_own') {
      const embed = new EmbedBuilder()
        .setTitle('🎵 Своя музыка')
        .setColor(0x7289DA)
        .setDescription('Воспроизведение музыки по названию. Поиск в интернете и добавление в очередь.');
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_custom_search').setLabel('🔎 Найти и играть').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music_custom_queue').setLabel('➕ Добавить в очередь').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_menu').setLabel('← В меню').setStyle(ButtonStyle.Danger)
      );

      try { await interaction.update({ embeds: [embed], components: [row] });
        if (guild && guild.id && interaction.message && interaction.message.id) { await _saveControlMessageForGuild(guild.id, interaction.channel.id, interaction.message.id).catch(()=>{}); }
      } catch (e) { await interaction.editReply({ embeds: [embed], components: [row] }).catch(()=>{}); }
      return;
    }

    // Search and play custom music
    if (customId === 'music_custom_search') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalRowBuilder } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('music_search_modal')
        .setTitle('🔎 Найти песню');
      
      const songInput = new TextInputBuilder()
        .setCustomId('song_name')
        .setLabel('Название песни (исполнитель)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
      
      modal.addComponents(new ModalRowBuilder().addComponents(songInput));
      
      await interaction.showModal(modal);
      return;
    }

    // Add to queue
    if (customId === 'music_custom_queue') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalRowBuilder } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('music_queue_modal')
        .setTitle('➕ Добавить в очередь');
      
      const songInput = new TextInputBuilder()
        .setCustomId('song_name_queue')
        .setLabel('Название песни (исполнитель)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
      
      modal.addComponents(new ModalRowBuilder().addComponents(songInput));
      
      await interaction.showModal(modal);
      return;
    }

    if (customId === 'music_link') {
      await interaction.reply({ content: '🔨 **Ссылка** - в разработке', flags: 64 });
      return;
    }

    // Back to main menu
    if (customId === 'music_back') {
      await interaction.deferReply({ flags: 64 });
      const embed = createMusicMenuEmbed();
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }

  } catch (err) {
    console.error('Music button handler error:', err);
    try {
      await interaction.reply({ content: `❌ Ошибка: ${err.message}`, flags: 64 });
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

