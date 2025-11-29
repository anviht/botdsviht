const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const stations = require('./stations.json');
const musicPlayer = require('../music/player2');

// Состояние радио для каждого гилда: какая станция сейчас играет
const radioState = new Map();

function getRadioState(guildId) {
  if (!radioState.has(guildId)) {
    radioState.set(guildId, {
      currentStation: null,
      isPlaying: false,
      volume: 1.0
    });
  }
  return radioState.get(guildId);
}

// Создать главную панель музыки
function createMusicMainPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🎵 Музыка')
    .setColor(0x9c27b0)
    .setDescription('Выберите источник музыки:');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('music_own').setLabel('🎶 Своя музыка').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('music_back').setLabel('← Назад').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

// Создать панель выбора радиостанций
function createRadioListPanel() {
  const embed = new EmbedBuilder()
    .setTitle('📻 Радиостанции')
    .setColor(0x2196f3)
    .setDescription('Выберите радиостанцию:');

  // Создаём кнопки по 5 на строку
  const rows = [];
  let currentRow = [];
  
  for (const station of stations) {
    if (currentRow.length === 5) {
      rows.push(new ActionRowBuilder().addComponents([...currentRow]));
      currentRow = [];
    }
    currentRow.push(
      new ButtonBuilder()
        .setCustomId(`radio_play_${station.id}`)
        .setLabel(station.name)
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  if (currentRow.length > 0) {
    rows.push(new ActionRowBuilder().addComponents([...currentRow]));
  }

  // Добавляем кнопку "Назад"
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_radio_back').setLabel('← Назад').setStyle(ButtonStyle.Secondary)
    )
  );

  return { embeds: [embed], components: rows };
}

// Создать панель во время проигрывания
function createRadioPlayingPanel(station) {
  const embed = new EmbedBuilder()
    .setTitle('🎵 Сейчас проигрывается')
    .setColor(0x4caf50)
    .setDescription(`**${station.name}**`)
    .setFooter({ text: 'Радио' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('radio_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('radio_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('music_radio_switch').setLabel('🔄 Другая станция').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('radio_stop').setLabel('⏹️ Стоп').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

// Обработчик кнопок музыки/радио
async function handleMusicButton(interaction) {
  const customId = interaction.customId;
  const guildId = interaction.guild.id;
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  try {
    // Главная панель музыки
    if (customId === 'music_radio') {
      await interaction.update(createRadioListPanel());
      return;
    }

    // Назад из главной музыки
    if (customId === 'music_back') {
      // Будет обработано в главном panel handler
      await interaction.update({ content: 'Закрываю панель...', components: [], embeds: [] });
      return;
    }

    // Назад из выбора радиостанций
    if (customId === 'music_radio_back') {
      await interaction.update(createMusicMainPanel());
      return;
    }

    // Проигрывание радиостанции
    if (customId.startsWith('radio_play_')) {
      if (!voiceChannel) {
        return await interaction.reply({ content: '❌ Вы должны быть в войс-канале', ephemeral: true });
      }

      await interaction.deferUpdate();

      const stationId = customId.replace('radio_play_', '');
      const station = stations.find(s => s.id === stationId);

      if (!station) {
        return await interaction.followUp({ content: '❌ Станция не найдена', ephemeral: true });
      }

      try {
        // Запускаем радио
        await musicPlayer.playNow(interaction.guild, voiceChannel, station.url, interaction.channel);
        
        // Сохраняем состояние
        const state = getRadioState(guildId);
        state.currentStation = station;
        state.isPlaying = true;
        state.volume = 1.0;

        // Обновляем панель
        await interaction.editReply(createRadioPlayingPanel(station));
      } catch (e) {
        console.error('Radio playback error:', e);
        await interaction.editReply({ content: '❌ Ошибка при подключении к каналу или проигрыванию', ephemeral: true });
      }
      return;
    }

    // Громкость вниз
    if (customId === 'radio_volume_down') {
      const state = getRadioState(guildId);
      if (state.currentStation && state.isPlaying) {
        try {
          const newVol = await musicPlayer.changeVolume(interaction.guild, -0.2);
          state.volume = newVol || state.volume;
          await interaction.update(createRadioPlayingPanel(state.currentStation));
        } catch (e) {
          console.error('Volume down error:', e);
          await interaction.reply({ content: '❌ Ошибка изменения громкости', ephemeral: true });
        }
      }
      return;
    }

    // Громкость вверх
    if (customId === 'radio_volume_up') {
      const state = getRadioState(guildId);
      if (state.currentStation && state.isPlaying) {
        try {
          const newVol = await musicPlayer.changeVolume(interaction.guild, 0.2);
          state.volume = newVol || state.volume;
          await interaction.update(createRadioPlayingPanel(state.currentStation));
        } catch (e) {
          console.error('Volume up error:', e);
          await interaction.reply({ content: '❌ Ошибка изменения громкости', ephemeral: true });
        }
      }
      return;
    }

    // Смена станции
    if (customId === 'music_radio_switch') {
      await interaction.update(createRadioListPanel());
      return;
    }

    // Остановка
    if (customId === 'radio_stop') {
      try {
        await musicPlayer.stop(interaction.guild);
        const state = getRadioState(guildId);
        state.isPlaying = false;
        state.currentStation = null;

        await interaction.update(createMusicMainPanel());
      } catch (e) {
        console.error('Radio stop error:', e);
        await interaction.reply({ content: '❌ Ошибка остановки музыки', ephemeral: true });
      }
      return;
    }

  } catch (e) {
    console.error('Music button handler error:', e);
    try {
      await interaction.reply({ content: '❌ Ошибка обработки кнопки', ephemeral: true });
    } catch (ignore) {}
  }
}

module.exports = {
  createMusicMainPanel,
  createRadioListPanel,
  createRadioPlayingPanel,
  handleMusicButton,
  getRadioState
};
