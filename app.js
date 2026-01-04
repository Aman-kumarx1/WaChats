const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');

// --- 1. Detect Environment & Setup ---
const isAndroid = os.platform() === 'android';
const puppeteerOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

if (isAndroid) {
    // Termux specific path
    // @ts-ignore
    puppeteerOpts.executablePath = '/usr/bin/chromium-browser';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOpts
});

const SYNC_TRACKER_PATH = path.join(__dirname, 'sync_history.json');

// --- 2. Helper Functions ---

// Global cleaner to prevent crashes on Windows filenames
const cleanName = (name) => {
    if (!name) return "Unknown";
    return name.replace(/[<>:"/\\|?*]/g, "").trim();
};

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

const getPaths = (chatName) => {
    const chatFolder = cleanName(chatName);
    const baseDir = path.join(__dirname, 'Backups', chatFolder);
    
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

// --- 3. Persistence & Sync Logic ---

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
        
        // Determine Chat Folder Name
        // Groups -> Group Name | DM -> Person's Name
        let chatFolderName;
        if (isActuallyGroup) {
            chatFolderName = chat.name || "Unknown Group";
        } else {
            // In DM, folder name is the contact's name, regardless of who sent the message
            chatFolderName = contact.name || contact.pushname || contact.number || "Unknown";
        }

        if (isIgnored(chatFolderName, chat.id._serialized)) return;

        const paths = getPaths(chatFolderName);
        const personName = contact.name || contact.pushname || contact.number || "Unknown";

        // --- DETERMINE LABEL (Sent vs Received) ---
        let senderLabel;
        if (msg.fromMe) {
            senderLabel = "Sent";
        } else {
            if (isActuallyGroup) {
                // In groups, add name so you know WHICH member sent it
                senderLabel = `Received (${personName})`;
            } else {
                senderLabel = "Received";
            }
        }

        const time = new Date(msg.timestamp * 1000).toLocaleString();
        
        // --- SAVE TEXT ---
        // Format: [Time] Sent: Message
        fs.appendFileSync(
            path.join(paths.messages, 'chat_history.txt'), 
            `[${time}] ${senderLabel}: ${msg.body}\n`
        );

        // --- SAVE MEDIA ---
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const ext = media.mimetype.split('/')[1].split(';')[0];
                
                // Safe filename: timestamp_Sent.jpg or timestamp_Received_John.jpg
                const safeLabel = cleanName(senderLabel);
                const filename = `${msg.timestamp}_${safeLabel}.${ext}`;
                const fullPath = path.join(paths.media, filename);
                
                if (!fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, media.data, { encoding: 'base64' });
                }
            }
        }
    } catch (err) { 
        // console.error(err); // Uncomment for debugging
    }
};

// --- 4. Events ---

client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log(`✅ ONLINE (${isAndroid ? 'Termux' : 'PC'})`);
    console.log("⏳ Waiting 5s before syncing...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    let chats = [];
    try {
        console.log(`🚀 Fetching Chats...`);
        chats = await client.getChats();
    } catch (err) {
        console.error("❌ Failed to fetch chats.", err);
        return;
    }

    const syncData = getSyncData();
    const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{chatName} | {bar} | {percentage}%'
    }, cliProgress.Presets.shades_grey);

    console.log("📥 Syncing History...");

    for (const chat of chats) {
        const name = chat.name || 'Unknown';
        if (isIgnored(name, chat.id._serialized)) continue;

        const lastSync = syncData[chat.id._serialized];
        
        // Fetch recent messages (up to 100 per chat for speed, increase if needed)
        let messages = await chat.fetchMessages({ limit: 100 });

        // Filter out already saved messages
        if (lastSync) {
            messages = messages.filter(m => m.timestamp > lastSync);
        }

        if (messages.length > 0) {
            const bar = multibar.create(messages.length, 0, { 
                chatName: name.slice(0, 15).padEnd(15) 
            });
            
            for (const msg of messages) {
                await saveMessageToLocal(msg, chat);
                bar.increment();
            }
            
            // Update sync timestamp
            const latestTimestamp = messages[messages.length - 1].timestamp;
            saveSyncTimestamp(chat.id._serialized, latestTimestamp);
            bar.stop();
        }
    }
    multibar.stop();
    console.log("🏁 Sync Complete. Listening for new messages...");
});

client.on('message_create', async (msg) => {
    const chat = await msg.getChat();
    await saveMessageToLocal(msg, chat);
    saveSyncTimestamp(chat.id._serialized, msg.timestamp);
});

client.initialize();