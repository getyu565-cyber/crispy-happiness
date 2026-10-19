const sqlite3 = require('node:sqlite');
const path = require('path');
const fs = require('node:fs');
const SMTPServer = require('smtp-server').SMTPServer;
const simpleParser = require('mailparser').simpleParser;

// =========================================================================
// 1. Configuration & Setup
// =========================================================================
const DB_DIR = path.join(__dirname, 'database');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');
const DOMAIN = 'tekomail.com'; 

// Use environment variable if available, otherwise default to 2525
const SMTP_PORT = process.env.SMTP_PORT || process.env.PORT || 2525; 
const POLLING_INTERVAL = 10000; // Check inbox every 10 seconds

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`[Setup] Created missing directory: ${DB_DIR}`);
}

/**
 * Generates a random Teko Mail address
 */
function generateTekoMail() {
    const randomString = Math.random().toString(36).substring(2, 11);
    return `${randomString}@${DOMAIN}`;
}

/**
 * Ensures the 'emails' table exists in the database
 */
function ensureTableExists(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient TEXT NOT NULL,
            sender TEXT,
            subject TEXT,
            body TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

/**
 * Saves a parsed incoming email into the SQLite database
 */
function saveEmailToDB(recipient, sender, subject, body) {
    try {
        const db = new sqlite3.DatabaseSync(DB_PATH);
        ensureTableExists(db);
        
        const stmt = db.prepare(`
            INSERT INTO emails (recipient, sender, subject, body) 
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(recipient.toLowerCase().trim(), sender, subject, body);
        console.log(`[SMTP] Successfully saved email for ${recipient} to database.`);
    } catch (err) {
        console.error(`[Database Save Error]: ${err.message}`);
    }
}

/**
 * Checks the local SQLite database for new emails sent to the target address
 */
function checkInbox(emailAddress) {
    let db;
    try {
        db = new sqlite3.DatabaseSync(DB_PATH);
        ensureTableExists(db);
    } catch (err) {
        console.error(`[Error] Failed to connect to database: ${err.message}`);
        return;
    }

    console.log(`\n[${new Date().toLocaleTimeString()}] Checking inbox for: ${emailAddress}...`);

    try {
        const stmt = db.prepare(`
            SELECT id, sender, subject, body, created_at 
            FROM emails 
            WHERE recipient = ? 
            ORDER BY created_at DESC
        `);
        const rows = stmt.all(emailAddress.toLowerCase().trim());

        if (rows.length === 0) {
            console.log('   No emails found yet.');
        } else {
            console.log(`   Found ${rows.length} email(s):`);
            rows.forEach((row, index) => {
                console.log(`\n--- [Message #${index + 1}] ---`);
                console.log(`From:     ${row.sender}`);
                console.log(`Subject:  ${row.subject}`);
                console.log(`Received: ${row.created_at}`);
                console.log(`Content:   ${row.body || '[Empty Body]'}`);
            });
        }
    } catch (err) {
        console.error(`[SQL Error]: ${err.message}`);
    }
}

// =========================================================================
// 2. SMTP Server Initialization
// =========================================================================
const smtpServer = new SMTPServer({
    disabledCommands: ['AUTH'], // Open relay for receiving public mail
    allowInsecureAuth: true,
    authOptional: true,
    
    // Handle incoming mail stream
    onData(stream, session, callback) {
        simpleParser(stream)
            .then(parsed => {
                const sender = session.envelope.mailFrom.address;
                
                // Route email to each recipient specified in envelope
                session.envelope.rcptTo.forEach(recipientObj => {
                    const recipient = recipientObj.address;
                    const subject = parsed.subject || '(No Subject)';
                    const body = parsed.text || parsed.html || '';
                    
                    console.log(`\n[SMTP] Incoming mail from ${sender} to ${recipient}`);
                    saveEmailToDB(recipient, sender, subject, body);
                });
                
                callback();
            })
            .catch(err => {
                console.error(`[SMTP Parse Error]: ${err.message}`);
                callback(err);
            });
    }
});

// Start listening on designated port
smtpServer.listen(SMTP_PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 SMTP Server listening on port ${SMTP_PORT}`);
    console.log(`=========================================`);
});

// =========================================================================
// 3. Application Execution Loop
// =========================================================================
const myTempEmail = generateTekoMail();
console.log(`Generated Temp Mail: ${myTempEmail}`);
console.log(`Database Location:   ${DB_PATH}`);
console.log(`Polling every ${POLLING_INTERVAL / 1000} seconds. Press Ctrl+C to stop.`);
console.log(`=========================================`);

// Check immediately on startup
checkInbox(myTempEmail);

// Poll database periodically for updates
setInterval(() => {
    checkInbox(myTempEmail);
}, POLLING_INTERVAL);
