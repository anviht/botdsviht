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
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary).setDisabled(true),
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

      // Get or create voice channel connection
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return await interaction.editReply({ content: '❌ Ты не подключен к голосовому каналу', flags: 64 });
      }

      try {
        // Play radio stream
        await musicPlayer.playNow(guild, voiceChannel, radio.url, interaction.channel);
          // For radio streams, mark as direct URL so it doesn't try YouTube search
          // Pass radio as special object that player2 recognizes
          const radioStream = { isDirectStream: true, url: radio.url };
          await musicPlayer.playRadio(guild, voiceChannel, radioStream, interaction.channel);
        
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

    // Coming soon messages
    if (customId === 'music_own') {
      await interaction.reply({ content: '🔨 **Своя музыка** - в разработке', flags: 64 });
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
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary).setDisabled(true),
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
