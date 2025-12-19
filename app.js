const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Detect Environment
const isAndroid = os.platform() === 'android';

// Create base options
const puppeteerOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

// Add executable path only if on Android
if (isAndroid) {
    puppeteerOpts['executablePath'] = '/usr/bin/chromium-browser';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOpts
});

// 2. Ignore List Logic
const isIgnored = (name, id) => {
    try {
        if (!fs.existsSync('ignore.txt')) return false;
        const ignoredList = fs.readFileSync('ignore.txt', 'utf8')
            .split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const cleanId = id.split('@')[0]; 
        return ignoredList.some(item => 
            (name && name.toLowerCase() === item.toLowerCase()) || (cleanId === item)
        );
    } catch (err) { return false; }
};

// 3. Folder Path Logic
const cleanFolderName = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();

const getPaths = (chatName, participantName, isGroup) => {
    const chatFolder = cleanFolderName(chatName);
    let baseDir = path.join(__dirname, 'Backups', chatFolder);
    if (isGroup) baseDir = path.join(baseDir, cleanFolderName(participantName));

    const paths = {
        messages: path.join(baseDir, 'messages'),
        media: path.join(baseDir, 'media'),
        calls: path.join(baseDir, 'calls')
    };
    Object.values(paths).forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });
    return paths;
};

client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log(`✅ ONLINE (${isAndroid ? 'Termux' : 'PC'}): Saving Data...`);
});

client.on('message_create', async (msg) => {
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const isActuallyGroup = chat.isGroup && chat.id._serialized.endsWith('@g.us');
        
        const chatName = chat.name || "Unknown";
        if (isIgnored(chatName, chat.id._serialized)) return;

        let paths;
        let senderLabel;
        const personName = contact.name || contact.pushname || contact.number;

        if (isActuallyGroup) {
            senderLabel = msg.fromMe ? "Sent by Me" : personName;
            paths = getPaths(chatName, senderLabel, true);
        } else {
            const folderOwner = msg.fromMe ? chatName : personName;
            paths = getPaths(folderOwner);
            senderLabel = msg.fromMe ? "ME" : "THEM";
        }

        const time = new Date().toLocaleString();
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), `[${time}] ${senderLabel}: ${msg.body}\n`);
        
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const ext = media.mimetype.split('/')[1].split(';')[0];
                const filename = `${Date.now()}_${cleanFolderName(senderLabel)}.${ext}`;
                fs.writeFileSync(path.join(paths.media, filename), media.data, { encoding: 'base64' });
            }
        }
    } catch (err) { console.error("Error:", err.message); }
});

client.initialize();