# 📱 WhatsApp Data Saver

A powerful, automated Node.js tool to backup your WhatsApp chats, media, and call history directly to your PC. This tool organizes data into a structured folder hierarchy, supports group chats, and includes a customizable ignore list for privacy.

---

## ✨ Features

- **🔄 Automatic Live Backup**: Saves messages and media the moment they are sent or received.
- **📂 Structured Storage**:
  - **Individual Chats**: Saved as `Backups/[Contact_Name]/...`
  - **Group Chats**: Saved as `Backups/[Group_Name]/[Participant_Name]/...`
- **⬆️ Sent History**: Includes a dedicated "Sent by Me" folder within groups to track your own activity.
- **📞 Call Logging**: Captures incoming and outgoing call details (Time, Duration, Type).
- **🛑 Smart Ignore List**: Easily exclude specific contacts or groups by adding them to `ignore.txt`.
- **🗑️ Anti-Delete Protection**: Even if a message is "Deleted for Everyone" by the sender, your local copy remains safe.
- **🔐 Privacy First**: All data is stored locally on your machine, not on any cloud server.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS version recommended)
- A mobile device with WhatsApp installed.

### Installation
1. Clone the Repository:
   git clone [https://github.com/Aman-kumarx1/WaChats.git](https://github.com/Aman-kumarx1/WaChats.git)
   cd WaChats
   
2. Install Dependencies:
   npm install
   node app.js

3. Link Device:
   A QR code will appear in your terminal.
   Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device.
   Scan the terminal QR code.
