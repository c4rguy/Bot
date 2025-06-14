import nextConnect from 'next-connect';
import multer from 'multer';
import fs from 'fs';
import { client, PermissionsBitField } from '../utils/discordClient.js';

// Save uploads to /tmp
const upload = multer({ storage: multer.diskStorage({
  destination: '/tmp',
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname),
}) });

const handler = nextConnect({
  onError(err, req, res) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});
handler.use(upload.single('image'));

handler.post(async (req, res) => {
  const { channelId, content } = req.body;
  const file = req.file;
  if (!channelId) return res.status(400).send('Channel ID is required.');
  if (!content && !file) return res.status(400).send('Content or image file required.');

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      if (file) fs.unlinkSync(file.path);
      return res.status(404).send('Channel not found.');
    }
    if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.SendMessages)) {
      if (file) fs.unlinkSync(file.path);
      return res.status(403).send('Bot lacks SendMessages permission.');
    }

    const opts = {};
    if (content) opts.content = content;
    if (file) opts.files = [{ attachment: file.path, name: file.originalname }];

    await channel.send(opts);
    if (file) fs.unlinkSync(file.path);
    return res.status(200).send('Message sent!');
  } catch (err) {
    console.error(err);
    if (file) fs.unlinkSync(file.path);
    return res.status(500).send('Failed to send message.');
  }
});

export const config = { api: { bodyParser: false } };
export default handler;
