// utils/discordClient.js
import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Missing DISCORD_TOKEN environment variable');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.login(token)
  .then(() => console.log(`✅ Logged in as ${client.user.tag}`))
  .catch(console.error);

export { client, PermissionsBitField };
