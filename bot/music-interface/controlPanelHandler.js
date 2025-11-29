const { createMainControlPanelEmbed, createPersonalCabinetEmbed, getMainControlRow, getCabinetControlRow } = require('./controlPanelEmbeds');

async function handleControlPanelButton(interaction) {
  const { customId, user, member } = interaction;

  try {
    // Main menu
    if (customId === 'main_menu') {
      await interaction.deferReply({ flags: 64 });
      const embed = createMainControlPanelEmbed();
      const row = getMainControlRow();
      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }

    // Personal Cabinet
    if (customId === 'cabinet_main') {
      await interaction.deferReply({ flags: 64 });
      const embed = createPersonalCabinetEmbed(member);
      const row = getCabinetControlRow();
      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }
  } catch (err) {
    console.error('Control panel button handler error:', err);
    try {
      await interaction.reply({ content: `❌ Ошибка: ${err.message}`, flags: 64 });
    } catch (e) {
      console.error('Failed to reply:', e);
    }
  }
}

function getControlPanelButtonHandler() {
  return handleControlPanelButton;
}

module.exports = {
  getControlPanelButtonHandler,
  handleControlPanelButton
};
