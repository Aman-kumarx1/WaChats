const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');

// Detect Environment
const isAndroid = os.platform() === 'android';
const puppeteerOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

if (isAndroid) {
    // @ts-ignore
    puppeteerOpts.executablePath = '/usr/bin/chromium-browser';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOpts
});

const SYNC_TRACKER_PATH = path.join(__dirname, 'sync_history.json');

// --- Helper Functions ---

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

const getPaths = (chatName, participantName, isGroup) => {
    const cleanFolderName = (n) => n.replace(/[<>:"/\\|?*]/g, "").trim();
    const chatFolder = cleanFolderName(chatName);
    let baseDir = path.join(__dirname, 'Backups', chatFolder);
    
    if (isGroup && participantName) {
        baseDir = path.join(baseDir, cleanFolderName(participantName));
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

// --- Sync & Persistence Logic ---

const getSyncData = () => {
    if (fs.existsSync(SYNC_TRACKER_PATH)) {
        return JSON.parse(fs.readFileSync(SYNC_TRACKER_PATH, 'utf8'));
    }
    return {};
};

const saveSyncTimestamp = (chatId, timestamp) => {
    const data = getSyncData();
    data[chatId] = timestamp;
    fs.writeFileSync(SYNC_TRACKER_PATH, JSON.stringify(data, null, 2));
};

const saveMessageToLocal = async (msg, chat) => {
    try {
        const contact = await msg.getContact();
        const isActuallyGroup = chat.isGroup && chat.id._serialized.endsWith('@g.us');
        const chatName = chat.name || "Unknown";
        
        if (isIgnored(chatName, chat.id._serialized)) return;

        let paths;
        let senderLabel;
        const personName = contact.name || contact.pushname || contact.number || "Unknown";

        if (isActuallyGroup) {
            senderLabel = msg.fromMe ? "Sent by Me" : personName;
            paths = getPaths(chatName, senderLabel, true);
        } else {
            const folderOwner = msg.fromMe ? chatName : personName;
            paths = getPaths(folderOwner);
            senderLabel = msg.fromMe ? "ME" : "THEM";
        }

        const time = new Date(msg.timestamp * 1000).toLocaleString();
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), `[${time}] ${senderLabel}: ${msg.body}\n`);

        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const ext = media.mimetype.split('/')[1].split(';')[0];
                const filename = `${msg.timestamp}_${senderLabel}.${ext}`;
                const fullPath = path.join(paths.media, filename);
                if (!fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, media.data, { encoding: 'base64' });
                }
            }
        }
    } catch (err) {
        // Silently skip if media download fails during bulk sync
    }
};

// --- Events ---

client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log(`✅ ONLINE (${isAndroid ? 'Termux' : 'PC'})`);
    console.log(`🚀 Starting History Sync...`);

    const chats = await client.getChats();
    const syncData = getSyncData();
    
    // Initialize Progress Bar
    const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{bar} | {percentage}% | {chatName}'
    }, cliProgress.Presets.shades_grey);

    for (const chat of chats) {
        if (isIgnored(chat.name, chat.id._serialized)) continue;

        const lastSync = syncData[chat.id._serialized];
        let messages = await chat.fetchMessages({ limit: 100 });
        
        // Filter messages if we have a last sync timestamp
        if (lastSync) {
            messages = messages.filter(m => m.timestamp > lastSync);
        }

        if (messages.length > 0) {
            const bar = multibar.create(messages.length, 0, { chatName: chat.name || 'Unknown' });
            
            for (const msg of messages) {
                await saveMessageToLocal(msg, chat);
                bar.increment();
            }
            
            const latestTimestamp = messages[messages.length - 1].timestamp;
            saveSyncTimestamp(chat.id._serialized, latestTimestamp);
        }
    }

    multibar.stop();
    console.log("🏁 All chats up to date. Live monitoring active.");
});

client.on('message_create', async (msg) => {
    const chat = await msg.getChat();
    await saveMessageToLocal(msg, chat);
    saveSyncTimestamp(chat.id._serialized, msg.timestamp);
});

client.initialize();