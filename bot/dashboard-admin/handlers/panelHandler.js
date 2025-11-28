// Panel handler — обработка кнопок панели управления
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../libs/db');
const presidentModel = require('../models/presidentModel');
const votingModel = require('../models/votingModel');
const userCabinetEmbeds = require('../embeds/userCabinet');
const governmentEmbeds = require('../embeds/government');
const musicPlayer = require('../../music/player2');

const PANEL_CHANNEL_ID = '1443194196172476636';

async function createMainPanel(client) {
  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!channel) return console.warn('Panel channel not found');

    const embed = new EmbedBuilder()
      .setTitle('🎛️ Панель управления Viht')
      .setColor(0x2F3136)
      .setDescription('Привет! Выбери из кнопок что тебе необходимо');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_main').setLabel('🎵 Музыка').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('shop_main').setLabel('💲 Прайс').setStyle(ButtonStyle.Secondary)
    );

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    let panelMsg = messages?.find(m => m.author.id === client.user.id && m.content.includes('🎛️'));
    
    if (panelMsg) {
      await panelMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
    } else {
      await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    }
    console.log('[Panel] Main panel created/updated');
  } catch (e) {
    console.error('createMainPanel error:', e.message);
  }
}

async function handlePanelButton(interaction) {
  const customId = interaction.customId;
  const user = interaction.user;
  const guild = interaction.guild;

  try {
    // Defer reply to prevent timeout for most handlers, but avoid deferring for music modal flow
    if (!customId.startsWith('music') && customId !== 'music_main') {
      await interaction.deferUpdate().catch(() => null);
    }

    if (customId === 'cabinet_main') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const embed = userCabinetEmbeds.createUserInfoEmbed(member);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cabinet_commands').setLabel('📋 Команды').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cabinet_balance').setLabel('💰 Баланс').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cabinet_status').setLabel('📊 Мой статус').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_commands') {
      const embed = userCabinetEmbeds.createCommandsEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_balance') {
      const embed = userCabinetEmbeds.createBalanceEmbed(user);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_status') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const presidentData = await presidentModel.getCurrentPresident(guild);
      const embed = userCabinetEmbeds.createUserStatusEmbed(member, presidentData);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'government_main') {
      const embed = governmentEmbeds.createGovernmentMenuEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gov_president_info').setLabel('👑 Кто Президент?').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gov_reelection').setLabel('🗳️ Переизбрание').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gov_voting').setLabel('📊 Голосование').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'gov_president_info') {
      const presidentData = await presidentModel.getCurrentPresident(guild);
      const embed = governmentEmbeds.createPresidentInfoEmbed(presidentData);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'gov_reelection') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const isAdmin = member && member.roles.cache.has('1436485697392607303');
      
      if (!isAdmin) {
        await interaction.followUp({ content: '❌ Только администраторы могут начать переизбрание', ephemeral: true }).catch(() => null);
        return;
      }

      // Remove president role from everyone
      await presidentModel.removePresidentRole(guild);

      // Get valid candidates
      const candidatesCollection = await guild.members.fetch().catch(() => null);
      const validCandidates = candidatesCollection ? Array.from(candidatesCollection.values()).filter(m => 
        presidentModel.VALID_VOTER_ROLES.some(r => m.roles.cache.has(r)) && !m.user.bot
      ) : [];

      // Start voting with candidates
      const candidateData = validCandidates.map(m => ({ id: m.id, username: m.user.username, tag: m.user.tag }));
      await votingModel.startPresidentVoting(guild, user.id, candidateData);
      
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Голосование за нового Президента')
        .setColor(0x1a472a)
        .setDescription(`✅ Голосование запущено!\nКандидатов: ${validCandidates.length}\nДлительность: 10 минут`)
        .setTimestamp();

      const votingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gov_vote_start').setLabel('🗳️ Голосовать').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [embed], components: [votingRow] }).catch(() => null);
      
      // Notify all users
      const panelChannel = await guild.channels.fetch('1443194196172476636').catch(() => null);
      if (panelChannel) {
        await panelChannel.send({
          content: `🗳️ **Началось голосование за нового Президента!**\nПроголосуйте в панели управления. У вас есть 10 минут!`
        }).catch(() => null);
      }
    }

    if (customId === 'gov_voting') {
      const voting = votingModel.getActiveVoting();
      if (!voting) {
        await interaction.followUp({ content: '❌ Нет активного голосования', ephemeral: true }).catch(() => null);
        return;
      }

      const remaining = votingModel.getVotingRemainingSeconds();
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Активное голосование')
        .setColor(0x1a472a)
        .addFields(
          { name: 'Тип', value: 'Выбор Президента', inline: true },
          { name: 'Осталось', value: `${remaining} сек`, inline: true }
        )
        .setTimestamp();

      const votingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gov_vote_start').setLabel('🗳️ Голосовать').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [embed], components: [votingRow] }).catch(() => null);
    }

    if (customId === 'back_main') {
      const embed = new EmbedBuilder()
        .setTitle('🎛️ Панель управления Viht')
        .setColor(0x2F3136)
        .setDescription('Привет! Выбери из кнопок что тебе необходимо');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_main').setLabel('🎵 Музыка').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('shop_main').setLabel('💲 Прайс').setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'shop_main') {
      const embed = new EmbedBuilder()
        .setTitle('💲 Прайс')
        .setColor(0x2F3136)
        .setDescription('🔧 Прайс в разработке...');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => null);
    }

    // Music flow
    if (customId === 'music_main') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const voiceChannel = member && member.voice ? member.voice.channel : null;
      if (!voiceChannel) {
        await interaction.reply({ content: '❌ Зайдите в голосовой канал, чтобы управлять музыкой.', ephemeral: true }).catch(() => null);
        return;
      }

      // If not playing - show modal to enter query/url
      const playing = musicPlayer.isPlaying(guild);
      if (!playing) {
        const modal = new ModalBuilder().setCustomId('music_modal').setTitle('Воспроизвести музыку');
        const input = new TextInputBuilder().setCustomId('music_query').setLabel('Название или ссылка').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        try {
          await interaction.showModal(modal);
        } catch (e) {
          console.error('showModal failed', e && e.message);
          await interaction.reply({ content: 'Не удалось открыть форму ввода.', ephemeral: true }).catch(() => null);
        }
        return;
      }

      // If playing - show controls (ephemeral)
      const embed = new EmbedBuilder().setTitle('🎵 Управление музыкой').setColor(0x1DB954).setDescription('Управление проигрывателем');
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_back').setLabel('⏪ Назад').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Остановить').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_next').setLabel('⏭ Вперёд').setStyle(ButtonStyle.Primary)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_vol_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_vol_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_queue_add').setLabel('➕ В очередь').setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true }).catch(() => null);
      return;
    }

    if (customId === 'music_stop' || customId === 'music_next' || customId === 'music_vol_up' || customId === 'music_vol_down' || customId === 'music_queue_add' || customId === 'music_back') {
      // handle in follow-up style
      if (customId === 'music_stop') {
        const ok = await musicPlayer.stop(guild);
        await interaction.reply({ content: ok ? '⏹ Плейер остановлен' : '❌ Не удалось остановить', ephemeral: true }).catch(() => null);
        return;
      }
      if (customId === 'music_next') {
        const ok = await musicPlayer.skip(guild);
        await interaction.reply({ content: ok ? '⏭ Пропускаю трек' : '❌ Не удалось пропустить', ephemeral: true }).catch(() => null);
        return;
      }
      if (customId === 'music_vol_up') {
        const vol = await musicPlayer.changeVolume(guild, 0.1);
        await interaction.reply({ content: vol ? `🔊 Громкость: ${Math.round(vol*100)}%` : '❌ Ошибка изменения громкости', ephemeral: true }).catch(() => null);
        return;
      }
      if (customId === 'music_vol_down') {
        const vol = await musicPlayer.changeVolume(guild, -0.1);
        await interaction.reply({ content: vol ? `🔉 Громкость: ${Math.round(vol*100)}%` : '❌ Ошибка изменения громкости', ephemeral: true }).catch(() => null);
        return;
      }
      if (customId === 'music_queue_add') {
        // open modal to add to queue
        const modal = new ModalBuilder().setCustomId('music_modal_queue').setTitle('Добавить в очередь');
        const input = new TextInputBuilder().setCustomId('music_query').setLabel('Ссылка или название').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        try { await interaction.showModal(modal); } catch (e) { await interaction.reply({ content: 'Не удалось открыть форму.', ephemeral: true }).catch(() => null); }
        return;
      }
      if (customId === 'music_back') {
        // go back to main panel view
        const embed = new EmbedBuilder()
          .setTitle('🎛️ Панель управления Viht')
          .setColor(0x2F3136)
          .setDescription('Привет! Выбери из кнопок что тебе необходимо');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cabinet_main').setLabel('👤 Личный кабинет').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('music_main').setLabel('🎵 Музыка').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('shop_main').setLabel('💲 Прайс').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
        return;
      }
    }

    if (customId === 'gov_vote_start') {
      const voting = votingModel.getActiveVoting();
      if (!voting) {
        await interaction.followUp({ content: '❌ Голосование завершилось', ephemeral: true }).catch(() => null);
        return;
      }

      // Get candidates from voting data
      const validCandidates = voting.candidates || [];

      if (validCandidates.length === 0) {
        await interaction.followUp({ content: '❌ Нет кандидатов для голосования', ephemeral: true }).catch(() => null);
        return;
      }

      // Create vote buttons (max 5 per row, max 25 total)
      const rows = [];
      for (let i = 0; i < validCandidates.length; i += 5) {
        const chunk = validCandidates.slice(i, i + 5);
        const row = new ActionRowBuilder().addComponents(
          ...chunk.map((c, idx) => new ButtonBuilder()
            .setCustomId(`vote_${c.id}`)
            .setLabel(c.username.slice(0, 20))
            .setStyle(ButtonStyle.Secondary)
          )
        );
        rows.push(row);
      }

      const embed = new EmbedBuilder()
        .setTitle('🗳️ Выберите кандидата')
        .setColor(0x1a472a)
        .setDescription(`Выберите, за кого вы голосуете\nКандидатов: ${validCandidates.length}`)
        .setTimestamp();

      await interaction.followUp({ embeds: [embed], components: rows, ephemeral: true }).catch(() => null);
    }

    // radio feature is currently in development; radio buttons are disabled

    // Vote handlers
    if (customId.startsWith('vote_')) {
      const candidateId = customId.replace('vote_', '');
      const voting = votingModel.getActiveVoting();

      if (!voting) {
        await interaction.followUp({ content: '❌ Голосование завершилось', ephemeral: true }).catch(() => null);
        return;
      }

      // Record vote using votingModel
      const voted = await votingModel.recordVote(user.id, candidateId);
      
      if (!voted) {
        await interaction.followUp({ content: '❌ Не удалось записать голос', ephemeral: true }).catch(() => null);
        return;
      }

      const candidate = voting.candidates?.find(c => c.id === candidateId);
      const candidateName = candidate?.username || 'неизвестный';
      await interaction.followUp({ content: `✅ Ваш голос за **${candidateName}** учтён!`, ephemeral: true }).catch(() => null);
    }
  } catch (e) {
    console.error('handlePanelButton error:', e.message);
    try {
      await interaction.followUp({ content: '❌ Ошибка при обработке кнопки', ephemeral: true }).catch(() => null);
    } catch (e2) {}
  }
}

module.exports = {
  createMainPanel,
  handlePanelButton
};
