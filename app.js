const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// 1. Initialize Client with Session Persistence
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 2. Ignore List Logic
const isIgnored = (name, id) => {
    try {
        if (!fs.existsSync('ignore.txt')) return false;
        const ignoredList = fs.readFileSync('ignore.txt', 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const cleanId = id.split('@')[0]; 
        return ignoredList.some(item => 
            (name && name.toLowerCase() === item.toLowerCase()) || (cleanId === item)
        );
    } catch (err) {
        return false;
    }
};

// 3. Folder Path Logic
const cleanName = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();

const getPaths = (chatName, participantName, isGroup) => {
    const chatFolder = cleanName(chatName);
    let baseDir = path.join(__dirname, 'Backups', chatFolder);

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

// 4. QR Code & Ready Events
client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ SYSTEM ONLINE: Monitoring Messages, Media, and Calls...');
});

// 5. CALL HISTORY
client.on('incoming_call', async (call) => {
    try {
        if (isIgnored(null, call.from)) return;

        const contactId = call.from;
        const paths = getPaths(contactId.split('@')[0]);
        
        const time = new Date().toLocaleString();
        const direction = call.fromMe ? "OUTGOING" : "INCOMING";
        const type = call.isVideo ? "VIDEO" : "VOICE";
        
        const log = `[${time}] ${direction} ${type} CALL | ID: ${call.id}\n`;
        fs.appendFileSync(path.join(paths.calls, 'call_history.txt'), log);
        console.log(`📞 Logged ${direction} call for: ${contactId}`);
    } catch (err) {
        console.error("Call Log Error:", err.message);
    }
});

// 6. MESSAGES & MEDIA (Sent & Received)
client.on('message_create', async (msg) => {
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        
        // 🛠️ FIX: Strict Group ID Check (@g.us)
        const isActuallyGroup = chat.isGroup && chat.id._serialized.endsWith('@g.us');
        
        const chatName = chat.name || "Unknown";
        const chatId = chat.id._serialized;
        const personName = contact.name || contact.pushname || contact.number;

        // 🛑 Skip if Ignored
        if (isIgnored(chatName, chatId)) return;

        let paths;
        let senderLabel;

        if (isActuallyGroup) {
            senderLabel = msg.fromMe ? "Sent by Me" : personName;
            paths = getPaths(chatName, senderLabel, true);
        } else {
            const folderOwner = msg.fromMe ? (chatName || contact.number) : personName;
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
                const filename = `${Date.now()}_${cleanName(senderLabel)}.${ext}`;
                fs.writeFileSync(path.join(paths.media, filename), media.data, { encoding: 'base64' });
            }
        }
        
        console.log(`✅ Saved ${senderLabel} data in: ${chatName}`);
    } catch (err) {
        console.error("Error:", err.message);
    }
});

client.initialize();const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Detect Environment (Termux vs Windows)
const isAndroid = os.platform() === 'android';
const puppeteerOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

// If on Android (Termux), point to the installed Chromium
if (isAndroid) {
    puppeteerOpts.executablePath = '/usr/bin/chromium-browser';
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

// 4. Message & Media Logic (With Group ID Fix)
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
        console.log(`✅ Saved ${senderLabel} in ${chatName}`);
    } catch (err) { console.error("Error:", err.message); }
});

client.initialize();