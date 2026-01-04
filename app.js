const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');
const ffmpeg = require('fluent-ffmpeg');

// --- 1. CONFIGURATION & SETUP ---

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
    // Removes special characters like / \ : * ? " < > | to prevent crashes
    return name.replace(/[<>:"/\\|?*]/g, "").trim();
};

const isIgnored = (name, id) => {
    try {
        if (!fs.existsSync('ignore.txt')) return false;
        const ignoredList = fs.readFileSync('ignore.txt', 'utf8')
            .split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const cleanId = id.split('@')[0];
        
        // Check if name or number exists in ignore list
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
            quotedText = quotedText.replace(/\n/g, ' '); 
            if (quotedText.length > 50) quotedText = quotedText.substring(0, 50) + "...";

            body = `\n\t|> Replying to ${quotedName}: "${quotedText}"\n\t| ${body}`;
        } catch (e) {
            // Ignore if quoted msg is missing
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
                try { fs.unlinkSync(inputPath); } catch(e){} // Delete .ogg
                resolve(outputPath);
            })
            .save(outputPath);
    });
};

// --- 4. MAIN SAVE LOGIC (Fixed for Folders & Labels) ---

const saveMessageToLocal = async (msg, chat) => {
    try {
        const contact = await msg.getContact();
        
        // [FIX] ALWAYS name the folder based on the Conversation Name (Chat Name)
        // This ensures Sent and Received messages stay in the SAME folder.
        let chatFolderName = chat.name || (await chat.getContact()).name || "Unknown";
        chatFolderName = cleanName(chatFolderName);

        if (isIgnored(chatFolderName, chat.id._serialized)) return;

        const paths = getPaths(chatFolderName);

        // [FIX] Label Logic: "sent" vs "received"
        let senderLabel;
        if (msg.fromMe) {
            senderLabel = "sent";
        } else {
            if (chat.isGroup) {
                // In groups, we need the name to know WHO sent it
                const senderName = contact.name || contact.pushname || contact.number || "User";
                senderLabel = `received (${senderName})`;
            } else {
                senderLabel = "received";
            }
        }

        const time = new Date(msg.timestamp * 1000).toLocaleString();
        
        // Process Text Body
        const finalBody = await formatMessageBody(msg);

        // Format: time : sent : Hiiiii
        const logEntry = `${time} : ${senderLabel} : ${finalBody}\n`;
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), logEntry);

        // Save Media
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                let ext = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
                if (ext === 'x-wav' || ext === 'ogg') ext = 'ogg'; 

                // [FIX] Sanitize senderLabel in filename to prevent crashes
                const safeLabel = cleanName(senderLabel);
                const filename = `${msg.timestamp}_${safeLabel}.${ext}`;
                const fullPath = path.join(paths.media, filename);

                if (!fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, media.data, { encoding: 'base64' });

                    // Convert OGG to MP3
                    if (ext === 'ogg') {
                        convertAudioToMp3(fullPath).catch(() => {});
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
    try {
        if (fs.existsSync(SYNC_TRACKER_PATH)) {
            const content = fs.readFileSync(SYNC_TRACKER_PATH, 'utf8');
            if (!content.trim()) return {};
            return JSON.parse(content);
        }
    } catch (err) {
        return {}; 
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
    console.log("⏳ Checking for missed messages...");
    
    // Slight delay to ensure internal sync
    await new Promise(resolve => setTimeout(resolve, 3000));

    let chats = [];
    try {
        chats = await client.getChats();
    } catch (err) {
        console.error("❌ Error fetching chats:", err);
        return;
    }

    const syncData = getSyncData();
    let pendingUpdates = [];

    // --- SMART SYNC LOGIC ---
    for (const chat of chats) {
        const lastSync = syncData[chat.id._serialized];

        if (lastSync) {
            // [CASE A] We have run this before. 
            // Fetch messages specifically to fill the gap (Catch-up).
            // Fetching 100 ensures we cover most downtime gaps.
            let messages = await chat.fetchMessages({ limit: 100 });
            
            // Only keep messages OLDER than now but NEWER than last disconnect
            messages = messages.filter(m => m.timestamp > lastSync);

            if (messages.length > 0) {
                console.log(`📥 Catching up ${messages.length} messages for: ${chat.name}`);
                for (const msg of messages) {
                    await saveMessageToLocal(msg, chat);
                }
                const latestTimestamp = messages[messages.length - 1].timestamp;
                saveSyncTimestamp(chat.id._serialized, latestTimestamp);
            }
        } else {
            // [CASE B] First time seeing this chat (or First Run ever).
            // Do NOT download history. Just mark "Now" as the start point.
            // This prevents downloading thousands of old messages.
            const nowTimestamp = Math.floor(Date.now() / 1000);
            saveSyncTimestamp(chat.id._serialized, nowTimestamp);
        }
    }
    
    console.log("🏁 Ready. Listening for new messages...");
});

// Real-time message listener
client.on('message_create', async (msg) => {
    const chat = await msg.getChat();
    await saveMessageToLocal(msg, chat);
    saveSyncTimestamp(chat.id._serialized, msg.timestamp);
});

client.initialize();