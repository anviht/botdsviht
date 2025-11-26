// Panel handler — обработка кнопок панели управления
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../libs/db');
const presidentModel = require('../models/presidentModel');
const votingModel = require('../models/votingModel');
const userCabinetEmbeds = require('../embeds/userCabinet');
const governmentEmbeds = require('../embeds/government');

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
      new ButtonBuilder().setCustomId('cabinet_main').setLabel('👤 Личный кабинет').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('government_main').setLabel('🏛️ Государственная Дума').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('shop_main').setLabel('🛍️ Магазин').setStyle(ButtonStyle.Secondary)
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
    if (customId === 'cabinet_main') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const embed = userCabinetEmbeds.createUserInfoEmbed(member);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cabinet_commands').setLabel('📋 Команды').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cabinet_balance').setLabel('💰 Баланс').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cabinet_status').setLabel('📊 Мой статус').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_commands') {
      const embed = userCabinetEmbeds.createCommandsEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_cabinet').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_balance') {
      const embed = userCabinetEmbeds.createBalanceEmbed(user);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_cabinet').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'cabinet_status') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const presidentData = await presidentModel.getCurrentPresident(guild);
      const embed = userCabinetEmbeds.createUserStatusEmbed(member, presidentData);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_cabinet').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'government_main') {
      const embed = governmentEmbeds.createGovernmentMenuEmbed();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gov_president_info').setLabel('👑 Кто Президент?').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gov_reelection').setLabel('🗳️ Переизбрание').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gov_voting').setLabel('📊 Голосование').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'gov_president_info') {
      const presidentData = await presidentModel.getCurrentPresident(guild);
      const embed = governmentEmbeds.createPresidentInfoEmbed(presidentData);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_government').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'gov_reelection') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const isAdmin = member && member.roles.cache.has('1436485697392607303');
      
      if (!isAdmin) {
        return await interaction.reply({ content: '❌ Только администраторы могут начать переизбрание', ephemeral: true }).catch(() => null);
      }

      // Remove president role from everyone
      await presidentModel.removePresidentRole(guild);

      // Start voting
      const candidates = await guild.members.fetch().catch(() => null);
      const validCandidates = candidates ? Array.from(candidates.values()).filter(m => 
        presidentModel.VALID_VOTER_ROLES.some(r => m.roles.cache.has(r)) && !m.user.bot
      ) : [];

      await votingModel.startPresidentVoting(guild, user.id);
      
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Голосование за нового Президента')
        .setColor(0x1a472a)
        .setDescription(`Началось голосование! Выбирайте из ${validCandidates.length} кандидатов.\nГолосование длится 10 минут.`)
        .setTimestamp();

      const votingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gov_vote_start').setLabel('🗳️ Голосовать').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_government').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [embed], components: [votingRow] }).catch(() => null);
    }

    if (customId === 'back_main' || customId === 'back_cabinet' || customId === 'back_government') {
      await createMainPanel(interaction.client);
      const embed = new EmbedBuilder()
        .setTitle('🎛️ Панель управления Viht')
        .setColor(0x2F3136)
        .setDescription('Привет! Выбери из кнопок что тебе необходимо');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cabinet_main').setLabel('👤 Личный кабинет').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('government_main').setLabel('🏛️ Государственная Дума').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('shop_main').setLabel('🛍️ Магазин').setStyle(ButtonStyle.Secondary)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (customId === 'shop_main') {
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Магазин')
        .setColor(0x2F3136)
        .setDescription('🔧 Магазин в разработке...');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('← Назад').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }
  } catch (e) {
    console.error('handlePanelButton error:', e.message);
  }
}

module.exports = {
  createMainPanel,
  handlePanelButton
};
