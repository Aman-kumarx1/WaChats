const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// 1. Initialize Client with persistent session
const client = new Client({
    authStrategy: new LocalAuth(), // Saves login data in .wwebjs_auth folder
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 2. Display QR Code in Terminal
client.on('qr', (qr) => {
    console.log('--- SCAN THE QR CODE BELOW ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ SYSTEM ONLINE: Saving Messages, Media, and Call Logs...');
});

// 3. Helper Function to create folder structure
const getPaths = (contactName) => {
    const cleanName = contactName.replace(/[<>:"/\\|?*]/g, "").trim();
    const baseDir = path.join(__dirname, 'Backups', cleanName);
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

// 4. Capture CALL HISTORY (Incoming & Outgoing)
client.on('incoming_call', async (call) => {
    try {
        const contactId = call.from;
        const paths = getPaths(contactId);
        
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

// 5. Capture ALL MESSAGES & MEDIA (Sent & Received)
client.on('message_create', async (msg) => {
    try {
        const contact = await msg.getContact();
        // Determine the other person's ID (the folder owner)
        let targetId = msg.fromMe ? msg.to : msg.from;
        const contactName = (contact.name || contact.number || targetId);
        
        const paths = getPaths(contactName);

        // Save Text Message
        const time = new Date().toLocaleString();
        const senderLabel = msg.fromMe ? "ME" : "THEM";
        const entry = `[${time}] ${senderLabel}: ${msg.body}\n`;
        
        fs.appendFileSync(path.join(paths.messages, 'chat_history.txt'), entry);
        console.log(`📝 Saved ${senderLabel} message in folder: ${contactName}`);

        // Save Media (Photos, Videos, Voice Notes, etc.)
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const ext = media.mimetype.split('/')[1].split(';')[0];
                const filename = `${Date.now()}_${senderLabel}.${ext}`;
                fs.writeFileSync(path.join(paths.media, filename), media.data, { encoding: 'base64' });
                console.log(`📁 Media saved for ${contactName}`);
            }
        }
    } catch (err) {
        console.error("Sync Error:", err.message);
    }
});

// 6. Monitor Deleted Messages (Revokes)
client.on('message_revoke_everyone', async (after, before) => {
    if (before) {
        console.log(`🚨 SENDER DELETED: "${before.body}". It remains safe in your Backups folder.`);
    }
});

client.initialize();