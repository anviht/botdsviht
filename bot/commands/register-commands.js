const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function registerCommands() {
  const { clientId, guildId, token } = config;
  if (!token) return console.error('DISCORD_TOKEN not set in env; skipping command registration');

  const commands = [];
  const commandsPath = path.join(__dirname);
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'register-commands.js');

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command.data) commands.push(command.data.toJSON());
    } catch (e) {
      console.warn('Failed loading command for registration:', file, e && e.message ? e.message : e);
    }
  }

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering commands...');
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log('Registered guild commands.');
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Registered global commands (may take up to 1 hour to propagate).');
    }
  } catch (err) {
    console.error('Failed to register commands', err);
  }
}

module.exports = registerCommands;
