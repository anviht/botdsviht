// Government embeds
const { EmbedBuilder } = require('discord.js');
const { getPresidentRemainingDays } = require('../models/presidentModel');

function createGovernmentMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('🏛️ Государственная Дума')
    .setColor(0x1a472a)
    .setDescription('Выберите действие:')
    .addFields(
      { name: 'Кто Президент?', value: 'Узнайте, кто текущий президент', inline: false },
      { name: 'Переизбрание Президента', value: 'Начать голосование за нового президента (только админы)', inline: false },
      { name: 'Голосование', value: 'Участвовать в текущем голосовании', inline: false }
    )
    .setTimestamp();
}

function createPresidentInfoEmbed(presidentData) {
  if (!presidentData) {
    return new EmbedBuilder()
      .setTitle('👑 Президент')
      .setColor(0xFFD700)
      .setDescription('Президент еще не избран')
      .setTimestamp();
  }

  const remainingDays = getPresidentRemainingDays();
  const electedDate = new Date(presidentData.electedAt).toLocaleDateString('ru-RU');

  return new EmbedBuilder()
    .setTitle('👑 Текущий Президент')
    .setColor(0xFFD700)
    .addFields(
      { name: 'Президент', value: presidentData.userTag, inline: false },
      { name: 'ID', value: presidentData.userId, inline: true },
      { name: 'Избран', value: electedDate, inline: true },
      { name: 'Дней осталось', value: `${remainingDays} дней`, inline: true }
    )
    .setTimestamp();
}

function createVotingCandidatesEmbed(candidates, remainingSeconds) {
  const candidateList = candidates.map(c => `• ${c.tag}`).join('\n') || 'Нет кандидатов';
  
  return new EmbedBuilder()
    .setTitle('🗳️ Голосование за Президента')
    .setColor(0x1a472a)
    .addFields(
      { name: 'Кандидаты', value: candidateList, inline: false },
      { name: 'Время до конца голосования', value: `${remainingSeconds} секунд`, inline: false }
    )
    .setTimestamp();
}

module.exports = {
  createGovernmentMenuEmbed,
  createPresidentInfoEmbed,
  createVotingCandidatesEmbed
};
