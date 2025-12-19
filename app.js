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

// --- IGNORE LOGIC ---
const isIgnored = (name, id) => {
    try {
        if (!fs.existsSync('ignore.txt')) return false;
        
        // Read ignore.txt and clean the data
        const ignoredList = fs.readFileSync('ignore.txt', 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const cleanId = id.split('@')[0]; // Gets just the number from 12345@c.us

        // Check if Name or Number matches anything in ignore.txt
        return ignoredList.some(item => 
            (name && name.toLowerCase() === item.toLowerCase()) || 
            (cleanId === item)
        );
    } catch (err) {
        console.error("Error reading ignore.txt:", err);
        return false;
    }
};

client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ SYSTEM ONLINE: Monitoring with Ignore List active...');
});

const cleanFolderName = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();

const getPaths = (chatName, participantName, isGroup) => {
    const chatFolder = cleanFolderName(chatName);
    let baseDir = path.join(__dirname, 'Backups', chatFolder);

    if (isGroup) {
        const subFolder = cleanFolderName(participantName);
        baseDir = path.join(baseDir, subFolder);
    }

    const paths = {
        messages: path.join(baseDir, 'messages'),
        media: path.join(baseDir, 'media'),
    };

    Object.values(paths).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    return paths;
};

client.on('message_create', async (msg) => {
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        
        const chatName = chat.name || "Unknown";
        const chatId = chat.id._serialized;
        const senderName = contact.name || contact.pushname || contact.number;
        const senderId = contact.id._serialized;

        // 🛑 SKIP CHECK
        // Check if the Chat itself (Group or Person) is in the ignore list
        if (isIgnored(chatName, chatId)) {
            return; 
        }

        let paths;
        let senderLabel;

        if (chat.isGroup) {
            senderLabel = msg.fromMe ? "Sent by Me" : senderName;
            paths = getPaths(chatName, senderLabel, true);
        } else {
            // For private chats, folder name is the person's name
            const folderOwner = msg.fromMe ? (chatName) : senderName;
            paths = getPaths(folderOwner);
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
                const filename = `${Date.now()}_${cleanFolderName(senderLabel)}.${ext}`;
                fs.writeFileSync(path.join(paths.media, filename), media.data, { encoding: 'base64' });
            }
        }
    } catch (err) {
        console.error("Error processing message:", err.message);
    }
});

client.initialize();