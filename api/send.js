import { client, PermissionsBitField } from '../utils/discordClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { channelId, content, imageUrl } = req.body;
  if (!channelId) return res.status(400).send('Channel ID is required.');
  if (!content && !imageUrl) return res.status(400).send('Content or imageUrl required.');

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).send('Channel not found.');

    if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.SendMessages)) {
      return res.status(403).send('Bot lacks SendMessages permission.');
    }

    const opts = {};
    if (content) opts.content = content;
    if (imageUrl) {
      try {
        new URL(imageUrl);
        opts.files = [{ attachment: imageUrl }];
      } catch {
        return res.status(400).send('Invalid imageUrl format.');
      }
    }

    await channel.send(opts);
    return res.status(200).send('Message sent!');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to send message.');
  }
}
