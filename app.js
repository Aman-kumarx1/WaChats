const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');
const ffmpeg = require('fluent-ffmpeg');

// --- 1. CONFIGURATION & SETUP ---

// Detect Environment (Termux vs Windows)
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

// --- 2. HELPER FUNCTIONS ---

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
        calls: path.join(baseDir, 'calls') // Placeholder for future use
    };

    Object.values(paths).forEach(dir => { 
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); 
    });
    return paths;
};

// --- 3. FORMATTING LOGIC ---

const formatMessageBody = async (msg) => {
    let body = msg.body;

    // A. Handle Special Message Types
    if (msg.type === 'location') {
        body = `📍 Location: https://www.google.com/maps/search/?api=1&query=${msg.location.latitude},${msg.location.longitude}`;
    } else if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
        body = `👤 Contact Card Shared`;
    } else if (msg.type === 'sticker') {
        body = `🖼️ (Sticker)`;
    }

    // B. Handle Replies (The "Reply Context")
    if (msg.hasQuotedMsg) {
        try {
            const quoted = await msg.getQuotedMessage();
            const quotedContact = await quoted.getContact();
            const quotedName = quotedContact.pushname || quotedContact.name || quotedContact.number;
            
            // Preview the quoted text (limit to 50 chars)
            let quotedText = quoted.body || (quoted.hasMedia ? "(Media)" : "(Unknown)");
            quotedText = quotedText.replace(/\n/g, ' '); // Remove newlines for cleaner text file
            if (quotedText.length > 50) quotedText = quotedText.substring(0, 50) + "...";

            // Format: 
            // |> Replying to John: "Hello there..."
            // | Received: I am fine
            body = `\n\t|> Replying to ${quotedName}: "${quotedText}"\n\t| ${body}`;
        } catch (e) {
            // If fetching quote fails, just return original body
        }
    }

    return body;
};

const convertAudioToMp3 = (inputPath) => {
    return new Promise((resolve, reject) => {
        const outputPath = inputPath.replace('.ogg', '.mp3');
        ffmpeg(inputPath)
            .toFormat('mp3')
            .on('error', (err) => reject(err))
            .on('end', () => {
                // Delete the original OGG file to save space
                try { fs.unlinkSync(inputPath); } catch(e){}
                resolve(outputPath);
            })
            .save(outputPath);
    });
};

// --- 4. MAIN SAVE LOGIC ---

const saveMessageToLocal = async (msg, chat) => {
    try {
        const contact = await msg.getContact();
        const isActuallyGroup = chat.isGroup && chat.id._serialized.endsWith('@g.us');
        
        // 1. Determine Folder Name (Chat Name)
        const chatFolderName = isActuallyGroup 
            ? (chat.name || "Unknown Group") 
            : (contact.name || contact.pushname || contact.number || "Unknown");

        if (isIgnored(chatFolderName, chat.id._serialized)) return;

        const paths = getPaths(chatFolderName);
        const personName = contact.name || contact.pushname || contact.number || "Unknown";

        // 2. Determine Sender Label
        let senderLabel;
        if (msg.fromMe) {
            senderLabel = "Sent";
        } else {
            senderLabel = isActuallyGroup ? `Received (${personName})` : "Received";
        }

        const time = new Date(msg.timestamp * 1000).toLocaleString();
        
        // 3. Process Text Body (handle replies, locations, etc)
        const finalBody = await formatMessageBody(msg);

        // 4. Save Text to File
        const logEntry = `[${time}] ${senderLabel}: ${finalBody}\n`;
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), logEntry);

        // 5. Save Media (with MP3 conversion)
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                // Get extension (default to bin if unknown)
                let ext = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
                
                // WhatsApp audio is usually ogg/opus
                if (ext === 'x-wav' || ext === 'ogg') ext = 'ogg'; 

                const safeLabel = cleanName(senderLabel);
                const filename = `${msg.timestamp}_${safeLabel}.${ext}`;
                const fullPath = path.join(paths.media, filename);

                // Only write if file doesn't exist
                if (!fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, media.data, { encoding: 'base64' });

                    // Convert OGG Voice Notes to MP3
                    if (ext === 'ogg') {
                        convertAudioToMp3(fullPath).catch(() => {
                            // If conversion fails (no ffmpeg), just keep the .ogg
                        });
                    }
                }
            }
        }
    } catch (err) {
        // console.error("Error saving message:", err.message); 
    }
};

// --- 5. SYNC HISTORY HELPERS ---

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

// --- 6. CLIENT EVENTS ---

client.on('qr', (qr) => {
    console.log('--- SCAN QR CODE ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log(`✅ ONLINE (${isAndroid ? 'Termux' : 'PC'})`);
    console.log("⏳ Initializing...");
    
    // Allow some time for internal sync
    await new Promise(resolve => setTimeout(resolve, 3000));

    let chats = [];
    try {
        chats = await client.getChats();
    } catch (err) {
        console.error("❌ Error fetching chats:", err);
        return;
    }

    const syncData = getSyncData();
    const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{chatName} | {bar} | {percentage}%'
    }, cliProgress.Presets.shades_grey);

    console.log(`📥 Syncing History for ${chats.length} chats...`);

    for (const chat of chats) {
        const name = chat.name || 'Unknown';
        if (isIgnored(name, chat.id._serialized)) continue;

        const lastSync = syncData[chat.id._serialized];
        
        // Fetch 50 messages to start. Increase this number if you want more history.
        let messages = await chat.fetchMessages({ limit: 50 });

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
            
            const latestTimestamp = messages[messages.length - 1].timestamp;
            saveSyncTimestamp(chat.id._serialized, latestTimestamp);
            bar.stop();
        }
    }
    multibar.stop();
    console.log("🏁 Sync Complete. Listening for new messages...");
});

// Real-time message listener
client.on('message_create', async (msg) => {
    const chat = await msg.getChat();
    await saveMessageToLocal(msg, chat);
    saveSyncTimestamp(chat.id._serialized, msg.timestamp);
});

client.initialize();