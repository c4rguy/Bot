const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  Collection,
} = require('discord.js');
const { token } = require('./config.json');

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB limit (Discord's limit)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const purgeCommand = new SlashCommandBuilder()
  .setName('purgespecific')
  .setDescription('Delete messages containing a specific word across the entire server')
  .addStringOption((option) =>
    option.setName('word').setDescription('Word to search for').setRequired(true)
  );

const msgCommand = new SlashCommandBuilder()
  .setName('msg')
  .setDescription('Send a message as the bot in this channel')
  .addStringOption((option) =>
    option.setName('content').setDescription('Message to send').setRequired(true)
  );

// Helper function to fetch messages (unchanged)
async function fetchMessages(channel, maxMessages = 1000) {
  let allMessages = new Map();
  let lastId = null;

  while (allMessages.size < maxMessages) {
    const options = { limit: Math.min(100, maxMessages - allMessages.size) };
    if (lastId) options.before = lastId;

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    for (const [id, msg] of fetched) {
      allMessages.set(id, msg);
    }

    lastId = fetched.last().id;
  }

  return allMessages;
}

const racistWords = ['nigga', 'nigger', 'rape'];

client.on('messageCreate', async (message) => {
  if (!message.guild) return;

  if (!message.guild.members.me.permissionsIn(message.channel).has(PermissionsBitField.Flags.ManageMessages)) return;

  const content = message.content.toLowerCase();
  if (racistWords.some((word) => content.includes(word))) {
    try {
      await message.delete();
      console.log(`Deleted racist message from ${message.author.tag} in #${message.channel.name}`);
    } catch (error) {
      console.error('Failed to delete racist message:', error);
    }
  }
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const clientId = client.application.id;
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('📤 Registering global slash commands...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: [purgeCommand.toJSON(), msgCommand.toJSON()],
    });
    console.log('✅ Slash commands registered globally!');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'purgespecific') {
    const word = interaction.options.getString('word').toLowerCase();
    const guild = interaction.guild;

    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({
        content: '❌ I need the Manage Messages permission in this server to do this!',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let totalDeleted = 0;

    try {
      for (const [, channel] of guild.channels.cache) {
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        )
          continue;

        const perms = channel.permissionsFor(guild.members.me);
        if (!perms || !perms.has(PermissionsBitField.Flags.ManageMessages)) continue;

        const messages = await fetchMessages(channel, 1000);

        const matchingMessages = new Collection(
          Array.from(messages).filter(([_, msg]) => {
            const ageDays = (Date.now() - msg.createdTimestamp) / (1000 * 60 * 60 * 24);
            return (
              msg.content.toLowerCase().includes(word) &&
              ageDays < 14 &&
              !msg.pinned
            );
          })
        );

        if (matchingMessages.size === 0) continue;

        const chunks = [];
        const arrayMessages = Array.from(matchingMessages.values());
        for (let i = 0; i < arrayMessages.length; i += 100) {
          chunks.push(arrayMessages.slice(i, i + 100));
        }

        for (const chunk of chunks) {
          try {
            await channel.bulkDelete(chunk, true);
            totalDeleted += chunk.length;
          } catch {
            for (const msg of chunk) {
              try {
                await msg.delete();
                totalDeleted++;
              } catch {}
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        console.log(`Deleted ${matchingMessages.size} messages in #${channel.name}`);
      }

      await interaction.editReply(
        `🧹 Deleted approximately ${totalDeleted} messages containing "${word}" across the server.`
      );
    } catch (error) {
      console.error('❌ Error deleting messages:', error);
      await interaction.editReply('❌ Something went wrong while deleting messages.');
    }
  } else if (interaction.commandName === 'msg') {
    const content = interaction.options.getString('content');

    if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
      return interaction.reply({ content: '❌ I do not have permission to send messages in this channel.', ephemeral: true });
    }

    try {
      await interaction.channel.send(content);
      await interaction.reply({ content: '✅ Message sent!', ephemeral: true });
    } catch (error) {
      console.error('Error sending message:', error);
      await interaction.reply({ content: '❌ Failed to send message.', ephemeral: true });
    }
  }
});

// Express Web UI with modern glassy dark theme
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pure</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f0f23 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            overflow-x: hidden;
            position: relative;
          }

          body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
              radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.15) 0%, transparent 50%),
              radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.1) 0%, transparent 50%);
            pointer-events: none;
            animation: float 8s ease-in-out infinite;
          }

          @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(1deg); }
          }

          .container {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 2.5rem;
            max-width: 500px;
            width: 90%;
            box-shadow: 
              0 8px 32px rgba(0, 0, 0, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
            position: relative;
            z-index: 10;
            animation: slideIn 0.6s ease-out;
          }

          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .header {
            text-align: center;
            margin-bottom: 2rem;
          }

          .header h1 {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
          }

          .header p {
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.95rem;
          }

          .form-group {
            margin-bottom: 1.5rem;
          }

          label {
            display: block;
            color: rgba(255, 255, 255, 0.9);
            font-weight: 600;
            margin-bottom: 0.5rem;
            font-size: 0.95rem;
          }

          input, textarea {
            width: 100%;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            color: #ffffff;
            font-size: 1rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
          }

          input:focus, textarea:focus {
            outline: none;
            border-color: rgba(102, 126, 234, 0.5);
            background: rgba(255, 255, 255, 0.08);
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            transform: translateY(-1px);
          }

          input::placeholder, textarea::placeholder {
            color: rgba(255, 255, 255, 0.4);
          }

          textarea {
            resize: vertical;
            min-height: 120px;
            font-family: inherit;
          }

          .btn {
            width: 100%;
            padding: 1rem 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
          }

          .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s ease;
          }

          .btn:hover::before {
            left: 100%;
          }

          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
          }

          .btn:active {
            transform: translateY(0);
          }

          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }

          .status {
            margin-top: 1.5rem;
            padding: 1rem;
            border-radius: 12px;
            font-weight: 500;
            text-align: center;
            min-height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
          }

          .status.success {
            background: rgba(34, 197, 94, 0.1);
            border-color: rgba(34, 197, 94, 0.3);
            color: #4ade80;
          }

          .status.error {
            background: rgba(239, 68, 68, 0.1);
            border-color: rgba(239, 68, 68, 0.3);
            color: #f87171;
          }

          .status.warning {
            background: rgba(245, 158, 11, 0.1);
            border-color: rgba(245, 158, 11, 0.3);
            color: #fbbf24;
          }

          .status.loading {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.3);
            color: #60a5fa;
          }

          .loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top: 2px solid #60a5fa;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 0.5rem;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .hotkey-hint {
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.5);
            margin-top: 0.5rem;
          }

          .image-option-tabs {
            display: flex;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 4px;
            margin-bottom: 1rem;
          }

          .tab-btn {
            flex: 1;
            padding: 0.75rem 1rem;
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.6);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            font-weight: 500;
          }

          .tab-btn.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }

          .tab-btn:hover:not(.active) {
            color: rgba(255, 255, 255, 0.8);
            background: rgba(255, 255, 255, 0.05);
          }

          .tab-content {
            margin-top: 1rem;
          }

          .file-upload-area {
            border: 2px dashed rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            padding: 2rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            background: rgba(255, 255, 255, 0.02);
          }

          .file-upload-area:hover {
            border-color: rgba(102, 126, 234, 0.5);
            background: rgba(255, 255, 255, 0.05);
          }

          .file-upload-area.dragover {
            border-color: #667eea;
            background: rgba(102, 126, 234, 0.1);
          }

          .upload-content {
            pointer-events: none;
          }

          .upload-icon {
            font-size: 2rem;
            margin-bottom: 0.5rem;
          }

          .upload-content p {
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 0.5rem;
          }

          .upload-content small {
            color: rgba(255, 255, 255, 0.5);
          }

          .file-preview {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 1rem;
            display: flex;
            align-items: center;
            gap: 1rem;
          }

          .file-preview img {
            width: 60px;
            height: 60px;
            object-fit: cover;
            border-radius: 8px;
          }

          .file-info {
            flex: 1;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .file-info span {
            color: rgba(255, 255, 255, 0.9);
            font-size: 0.9rem;
          }

          .remove-btn {
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #f87171;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            cursor: pointer;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
          }

          .remove-btn:hover {
            background: rgba(239, 68, 68, 0.3);
          }

          @media (max-width: 768px) {
            .container {
              margin: 1rem;
              padding: 2rem;
            }
            
            .header h1 {
              font-size: 1.5rem;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">

          </div>
          
          <div class="form-group">
            <label for="channelId">Channel ID</label>
            <input type="text" id="channelId" placeholder="Enter Discord Channel ID" required autofocus />
          </div>
          
          <div class="form-group">
            <label for="content">Message Content</label>
            <textarea id="content" placeholder="Type your message here..."></textarea>
            <div class="hotkey-hint">Press Ctrl+Enter to send • Shift+Enter for new line</div>
          </div>

          <div class="form-group">
            <label for="imageOption">Image Option</label>
            <div class="image-option-tabs">
              <button type="button" class="tab-btn active" data-tab="none">Text Only</button>
              <button type="button" class="tab-btn" data-tab="url">Image URL</button>
              <button type="button" class="tab-btn" data-tab="upload">Upload File</button>
            </div>
            
            <div id="urlTab" class="tab-content" style="display: none;">
              <input type="url" id="imageUrl" placeholder="https://example.com/image.png" />
              <div class="hotkey-hint">Enter a direct link to an image file</div>
            </div>
            
            <div id="uploadTab" class="tab-content" style="display: none;">
              <div class="file-upload-area" id="fileUploadArea">
                <input type="file" id="fileInput" accept="image/*" style="display: none;" />
                <div class="upload-content">
                  <div class="upload-icon">📁</div>
                  <p>Click to select an image or drag & drop</p>
                  <small>PNG, JPG, GIF, WebP (max 8MB)</small>
                </div>
              </div>
              <div id="filePreview" class="file-preview" style="display: none;">
                <img id="previewImage" alt="Preview" />
                <div class="file-info">
                  <span id="fileName"></span>
                  <button type="button" id="removeFile" class="remove-btn">×</button>
                </div>
              </div>
            </div>
          </div>
          
          <button id="sendBtn" class="btn">
            <span id="btnText">Send Message</span>
          </button>
          
          <div id="status" class="status"></div>
        </div>

        <script>
          const sendBtn = document.getElementById('sendBtn');
          const btnText = document.getElementById('btnText');
          const channelInput = document.getElementById('channelId');
          const contentInput = document.getElementById('content');
          const statusDiv = document.getElementById('status');
          const imageUrlInput = document.getElementById('imageUrl');
          const fileInput = document.getElementById('fileInput');
          const fileUploadArea = document.getElementById('fileUploadArea');
          const filePreview = document.getElementById('filePreview');
          const previewImage = document.getElementById('previewImage');
          const fileName = document.getElementById('fileName');
          const removeFile = document.getElementById('removeFile');

          let selectedFile = null;
          let currentTab = 'none';

          // Tab switching
          document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              
              currentTab = btn.dataset.tab;
              
              document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
              });
              
              if (currentTab !== 'none') {
                document.getElementById(currentTab + 'Tab').style.display = 'block';
              }
              
              // Clear previous selections
              selectedFile = null;
              imageUrlInput.value = '';
              filePreview.style.display = 'none';
            });
          });

          // File upload handling
          fileUploadArea.addEventListener('click', () => {
            fileInput.click();
          });

          fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.classList.add('dragover');
          });

          fileUploadArea.addEventListener('dragleave', () => {
            fileUploadArea.classList.remove('dragover');
          });

          fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
              handleFileSelect(files[0]);
            }
          });

          fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
              handleFileSelect(e.target.files[0]);
            }
          });

          removeFile.addEventListener('click', () => {
            selectedFile = null;
            fileInput.value = '';
            filePreview.style.display = 'none';
          });

          function handleFileSelect(file) {
            if (file.size > 8 * 1024 * 1024) {
              showStatus('❌ File size must be under 8MB', 'error');
              return;
            }

            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
              showStatus('❌ Only image files are allowed', 'error');
              return;
            }

            selectedFile = file;
            fileName.textContent = file.name;
            
            const reader = new FileReader();
            reader.onload = (e) => {
              previewImage.src = e.target.result;
              filePreview.style.display = 'flex';
            };
            reader.readAsDataURL(file);
          }

          async function sendMessage() {
            const channelId = channelInput.value.trim();
            const content = contentInput.value.trim();
            const imageUrl = imageUrlInput.value.trim();

            if (!channelId) {
              showStatus('⚠️ Please enter a Channel ID.', 'warning');
              channelInput.focus();
              return;
            }

            // At least one of content, imageUrl, or selectedFile must be provided
            if (!content && !imageUrl && !selectedFile) {
              showStatus('⚠️ Please enter a message, image URL, or select a file.', 'warning');
              return;
            }

            sendBtn.disabled = true;
            btnText.innerHTML = '<div class="loading-spinner"></div>Sending...';
            showStatus('<div class="loading-spinner"></div>Sending message...', 'loading');

            try {
              let response;
              
              if (currentTab === 'upload' && selectedFile) {
                // Send file upload
                const formData = new FormData();
                formData.append('channelId', channelId);
                formData.append('content', content);
                formData.append('image', selectedFile);

                response = await fetch('/send-with-file', {
                  method: 'POST',
                  body: formData,
                });
              } else {
                // Send text/URL
                response = await fetch('/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    channelId, 
                    content: content || undefined,
                    imageUrl: currentTab === 'url' ? imageUrl : undefined
                  }),
                });
              }

              if (response.ok) {
                showStatus('✅ Message sent successfully!', 'success');
                contentInput.value = '';
                imageUrlInput.value = '';
                selectedFile = null;
                fileInput.value = '';
                filePreview.style.display = 'none';
                contentInput.focus();
              } else {
                const text = await response.text();
                showStatus('❌ Error: ' + text, 'error');
              }
            } catch (err) {
              showStatus('❌ Network error - Please check your connection', 'error');
            } finally {
              sendBtn.disabled = false;
              btnText.textContent = 'Send Message';
              setTimeout(() => {
                clearStatus();
              }, 5000);
            }
          }

          function showStatus(message, type = '') {
            statusDiv.innerHTML = message;
            statusDiv.className = 'status ' + type;
          }

          function clearStatus() {
            statusDiv.innerHTML = '';
            statusDiv.className = 'status';
          }

          sendBtn.addEventListener('click', sendMessage);

          contentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              sendMessage();
            }
          });

          // Add some subtle interaction feedback
          [channelInput, contentInput, imageUrlInput].forEach(input => {
            input.addEventListener('focus', () => {
              input.style.transform = 'scale(1.01)';
            });
            
            input.addEventListener('blur', () => {
              input.style.transform = 'scale(1)';
            });
          });
        </script>
      </body>
    </html>
  `);
});

app.post('/send', async (req, res) => {
  const { channelId, content, imageUrl } = req.body;

  if (!channelId) {
    return res.status(400).send('Channel ID is required.');
  }

  if (!content && !imageUrl) {
    return res.status(400).send('Either message content or image URL is required.');
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).send('Channel not found.');

    // Check if bot can send messages in this channel
    if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.SendMessages)) {
      return res.status(403).send('Bot does not have permission to send messages in that channel.');
    }

    const messageOptions = {};
    
    if (content) {
      messageOptions.content = content;
    }
    
    if (imageUrl) {
      // Validate URL format
      try {
        new URL(imageUrl);
        messageOptions.files = [{ attachment: imageUrl }];
      } catch {
        return res.status(400).send('Invalid image URL format.');
      }
    }

    await channel.send(messageOptions);
    res.status(200).send('Message sent!');
  } catch (error) {
    console.error(error);
    if (error.message.includes('Invalid URL')) {
      res.status(400).send('Invalid or inaccessible image URL.');
    } else {
      res.status(500).send('Failed to send message.');
    }
  }
});

app.post('/send-with-file', upload.single('image'), async (req, res) => {
  const { channelId, content } = req.body;
  const imageFile = req.file;

  if (!channelId) {
    return res.status(400).send('Channel ID is required.');
  }

  if (!content && !imageFile) {
    return res.status(400).send('Either message content or image file is required.');
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      // Clean up uploaded file
      if (imageFile) fs.unlinkSync(imageFile.path);
      return res.status(404).send('Channel not found.');
    }

    // Check if bot can send messages in this channel
    if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.SendMessages)) {
      // Clean up uploaded file
      if (imageFile) fs.unlinkSync(imageFile.path);
      return res.status(403).send('Bot does not have permission to send messages in that channel.');
    }

    const messageOptions = {};
    
    if (content) {
      messageOptions.content = content;
    }
    
    if (imageFile) {
      messageOptions.files = [{
        attachment: imageFile.path,
        name: imageFile.originalname
      }];
    }

    await channel.send(messageOptions);
    
    // Clean up uploaded file after sending
    if (imageFile) {
      fs.unlinkSync(imageFile.path);
    }
    
    res.status(200).send('Message sent!');
  } catch (error) {
    console.error(error);
    
    // Clean up uploaded file on error
    if (imageFile) {
      fs.unlinkSync(imageFile.path);
    }
    
    res.status(500).send('Failed to send message.');
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Web UI available at http://localhost:${PORT}`);
});

client.login(token);