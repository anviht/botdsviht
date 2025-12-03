const { ActionRowBuilder } = require('discord.js');

async function safeReply(interaction, options) {
  try {
    const payload = (typeof options === 'string') ? { content: options } : { ...options };
    if (payload.ephemeral) { payload.flags = 64; delete payload.ephemeral; }
    if (interaction.replied || interaction.deferred) {
      try {
        if (typeof payload.content === 'string') await interaction.editReply({ content: payload.content });
        else await interaction.editReply(payload);
      } catch (e) {
        try { await interaction.followUp(payload); } catch (e2) { console.error('safeReply followUp failed', e2); }
      }
    } else {
      await interaction.reply(payload);
    }
  } catch (e) {
    if (e && e.code === 10062) return; // Unknown interaction
    console.error('safeReply error', e && e.message ? e.message : e);
  }
}

async function safeUpdate(interaction, options) {
  try {
    const payload = (typeof options === 'string') ? { content: options } : { ...options };
    if (payload.ephemeral) { payload.flags = 64; delete payload.ephemeral; }
    await interaction.update(payload);
  } catch (e) {
    if (e && e.code === 10062) return;
    console.error('safeUpdate error', e && e.message ? e.message : e);
  }
}

async function safeShowModal(interaction, modal, attempts = 2) {
  let attempt = 0;
  while (attempt <= attempts) {
    attempt += 1;
    try {
      await interaction.showModal(modal);
      return;
    } catch (e) {
      if (e && e.code === 'UND_ERR_CONNECT_TIMEOUT' && attempt <= attempts) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      console.error('showModal failed', e && e.message ? e.message : e);
      try { await safeReply(interaction, { content: 'Не удалось открыть форму.', ephemeral: true }); } catch (ignore) {}
      return;
    }
  }
}

module.exports = { safeReply, safeUpdate, safeShowModal };
