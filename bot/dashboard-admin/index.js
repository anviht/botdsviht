// Dashboard-admin init — загрузка всех компонентов
const panelHandler = require('./handlers/panelHandler');
const { startPresidentTimer } = require('./tasks/presidentTimer');

async function initDashboardAdmin(client) {
  try {
    // Create main panel
    await panelHandler.createMainPanel(client);
    
    // Start president timer
    startPresidentTimer(client);
    
    console.log('[DashboardAdmin] Initialized successfully');
  } catch (e) {
    console.error('[DashboardAdmin] Init error:', e.message);
  }
}

function getPanelButtonHandler() {
  return panelHandler.handlePanelButton;
}

module.exports = {
  initDashboardAdmin,
  getPanelButtonHandler
};
