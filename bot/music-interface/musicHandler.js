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

async function handleMusicButton(interaction) {
  const { customId, user, member, guild, client } = interaction;

  try {
    // Main music menu - show options
    if (customId === 'music_menu') {
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

    // Show radio list
    if (customId === 'music_radio') {
      await interaction.deferReply({ flags: 64 });
      const embed = createRadioListEmbed();
      
      const radioButtons = radios.map((radio, idx) =>
        new ButtonBuilder()
          .setCustomId(`radio_play_${radio.id}`)
          .setLabel(radio.label.substring(0, 80))
          .setStyle(ButtonStyle.Success)
      );

      // Split buttons into rows (max 5 per row)
      const rows = [];
      for (let i = 0; i < radioButtons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(radioButtons.slice(i, i + 5)));
      }

      // Add back button
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_menu').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      ));

      await interaction.editReply({ embeds: [embed], components: rows });
      return;
    }

    // Play radio station
    if (customId.startsWith('radio_play_')) {
      await interaction.deferReply({ flags: 64 });
      
      const radioId = customId.replace('radio_play_', '');
      const radio = radios.find(r => r.id === radioId);
      
      if (!radio) {
        return await interaction.editReply({ content: '❌ Радиостанция не найдена', flags: 64 });
      }

      // Get or create voice channel connection — ensure member is fetched so voice state is available
      let memberRef = member;
      if ((!memberRef || !memberRef.voice || !memberRef.voice.channel) && guild) {
        try { memberRef = await guild.members.fetch(user.id).catch(() => null); } catch (e) { memberRef = null; }
      }
      const voiceChannel = memberRef?.voice?.channel;
      if (!voiceChannel) {
        return await interaction.editReply({ content: '❌ Ты не подключен к голосовому каналу', flags: 64 });
      }

      try {
        // Play radio stream directly (bypass YouTube search)
        const radioStream = { url: radio.url };
        const ok = await musicPlayer.playRadio(guild, voiceChannel, radioStream, interaction.channel);
        if (!ok) {
          return await interaction.editReply({ content: '❌ Не удалось подключиться к радиостанции.', flags: 64 });
        }

        // Store active radio info
        activeRadios.set(guild.id, { radio, userId: user.id });

        // Show now playing embed with controls
        const embed = createPlayerControlsEmbed(radio.label);
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_next_station').setLabel('📻 Другая станция').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ embeds: [embed], components: [controlRow] });
      } catch (err) {
        console.error('Error playing radio:', err);
        await interaction.editReply({ content: `❌ Ошибка при подключении к радио: ${err.message}`, flags: 64 });
      }
      return;
    }

    // Volume controls
    if (customId === 'radio_volume_up') {
      await interaction.deferReply({ flags: 64 });
      try {
        const newVol = await musicPlayer.changeVolume(guild, 0.1);
        await interaction.editReply({ content: `🔊 Громкость: ${Math.round(newVol * 100)}%`, flags: 64 });
      } catch (err) {
        await interaction.editReply({ content: '❌ Ошибка при изменении громкости', flags: 64 });
      }
      return;
    }

    if (customId === 'radio_volume_down') {
      await interaction.deferReply({ flags: 64 });
      try {
        const newVol = await musicPlayer.changeVolume(guild, -0.1);
        await interaction.editReply({ content: `🔉 Громкость: ${Math.round(newVol * 100)}%`, flags: 64 });
      } catch (err) {
        await interaction.editReply({ content: '❌ Ошибка при изменении громкости', flags: 64 });
      }
      return;
    }

    // Switch station (go back to radio list)
    if (customId === 'radio_next_station') {
      await interaction.deferReply({ flags: 64 });
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

      await interaction.editReply({ embeds: [embed], components: rows });
      return;
    }

    // Stop radio
    if (customId === 'radio_stop') {
      await interaction.deferReply({ flags: 64 });
      try {
        await musicPlayer.stop(guild);
        activeRadios.delete(guild.id);
        
        const embed = new EmbedBuilder()
          .setTitle('⏹️ Музыка остановлена')
          .setColor(0xFF5252)
          .setDescription('Плеер выключен');
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_menu').setLabel('← В главное меню').setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      } catch (err) {
        await interaction.editReply({ content: '❌ Ошибка при остановке плеера', flags: 64 });
      }
      return;
    }

    // Custom music - show search and queue options
    if (customId === 'music_own') {
      await interaction.deferReply({ flags: 64 });
      
      const embed = new EmbedBuilder()
        .setTitle('🎵 Своя музыка')
        .setColor(0x7289DA)
        .setDescription('Воспроизведение музыки по названию. Поиск в интернете и добавление в очередь.');
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_custom_search').setLabel('🔎 Найти и играть').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music_custom_queue').setLabel('➕ Добавить в очередь').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_menu').setLabel('← В меню').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
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
  handleMusicButton
};
