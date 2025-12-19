const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ SYSTEM ONLINE: Saving Data with "Sent by Me" Folders...');
});

// Helper to clean folder names
const cleanName = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();

// Enhanced Folder Logic
const getPaths = (chatName, participantName, isGroup) => {
    const chatFolder = cleanName(chatName);
    let baseDir = path.join(__dirname, 'Backups', chatFolder);

    // If Group, create a subfolder for the sender (or "Sent by Me")
    if (isGroup) {
        const subFolder = cleanName(participantName);
        baseDir = path.join(baseDir, subFolder);
    }

    const paths = {
        messages: path.join(baseDir, 'messages'),
        media: path.join(baseDir, 'media'),
        calls: path.join(baseDir, 'calls')
    };

    Object.values(paths).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    return paths;
};

// Capture ALL Messages (Sent & Received)
client.on('message_create', async (msg) => {
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        
        let paths;
        let senderLabel;

        if (chat.isGroup) {
            const groupName = chat.name || "Unknown Group";
            // If message is from me, name the subfolder "Sent by Me"
            senderLabel = msg.fromMe ? "Sent by Me" : (contact.name || contact.pushname || contact.number);
            paths = getPaths(groupName, senderLabel, true);
        } else {
            // Private Chat logic
            const targetId = msg.fromMe ? msg.to : msg.from;
            const personName = contact.name || contact.number || targetId;
            paths = getPaths(personName);
            senderLabel = msg.fromMe ? "ME" : "THEM";
        }

        // Save Text
        const time = new Date().toLocaleString();
        const entry = `[${time}] ${senderLabel === "Sent by Me" ? "ME" : senderLabel}: ${msg.body}\n`;
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), entry);
        
        // Save Media
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const ext = media.mimetype.split('/')[1].split(';')[0];
                const filename = `${Date.now()}_${cleanName(senderLabel)}.${ext}`;
                fs.writeFileSync(path.join(paths.media, filename), media.data, { encoding: 'base64' });
            }
        }
        
        console.log(`✅ Saved ${senderLabel} data in ${chat.name || "Chat"}`);
    } catch (err) {
        console.error("Error:", err.message);
    }
});

client.initialize();