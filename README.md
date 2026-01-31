# 🎵 SyncJam - Real-Time Synchronized Music Room

A real-time synchronized YouTube music player that allows multiple users to watch and listen to videos together in perfect sync. Built with Socket.IO, Express, and modern web technologies.

![SyncJam Banner](https://img.shields.io/badge/SyncJam-Real--Time%20Music-00d4ff?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=for-the-badge&logo=socket.io)
![License](https://img.shields.io/badge/License-MIT-8338ec?style=for-the-badge)

## ✨ Features

- 🎬 **Real-Time Synchronization** - All users in a room watch the same video at the exact same time
- 🔐 **Private Rooms** - Create rooms with unique 6-digit codes
- 👥 **Multi-User Support** - Up to 50 users per room
- 💬 **Live Chat** - Built-in chat system for each room
- 🎮 **Host Controls** - Room host can control playback for everyone
- ⚡ **Low Latency** - Real-time latency monitoring (typically <50ms)
- 📱 **Mobile Responsive** - Beautiful UI optimized for all devices
- 🌙 **Dark Theme** - Professional black theme with cyan-purple accents
- 🔄 **Auto-Sync** - Automatic time synchronization every 3 seconds
- 🎯 **No Registration** - Start instantly, no account needed

## 🚀 Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Modern web browser

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/syncjam.git
cd syncjam
```

2. **Install dependencies**
```bash
npm install
```

3. **Project Structure**
```
syncjam/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server.js
├── package.json
└── README.md
```

4. **Start the server**
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

5. **Open your browser**
```
http://localhost:3000
```

## 🎯 Usage

### Creating a Room

1. Click **"Create Room"** on the home page
2. Share the 6-digit room code with friends
3. Paste any YouTube URL or video ID
4. Click **"Load & Sync"** to start playing

### Joining a Room

1. Enter the 6-digit room code
2. Click **"Join Room"**
3. Enjoy synchronized playback with others!

### Room Controls (Host Only)

- **Load Video**: Paste YouTube URL to change video
- **Play/Pause**: Control playback for everyone
- **Seek**: Jump to any position in the video
- **Volume**: Individual volume control per user

## 🛠️ Technology Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with gradients and animations
- **JavaScript (ES6+)** - Client-side logic
- **Socket.IO Client** - Real-time communication
- **YouTube IFrame API** - Video playback

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Socket.IO** - WebSocket library
- **CORS** - Cross-origin resource sharing

## 📡 API Endpoints

### Health Check
```http
GET /api/health
```
Returns server status and uptime

**Response:**
```json
{
  "status": "ok",
  "rooms": 5,
  "uptime": 3600,
  "timestamp": "2025-01-26T10:00:00.000Z"
}
```

### Statistics
```http
GET /api/stats
```
Returns detailed room statistics

**Response:**
```json
{
  "totalRooms": 5,
  "totalUsers": 23,
  "rooms": [
    {
      "code": "ABC123",
      "users": 8,
      "host": "socket-id",
      "currentVideo": "dQw4w9WgXcQ",
      "createdAt": 1706270400000
    }
  ]
}
```

## 🔌 Socket Events

### Client to Server

| Event | Data | Description |
|-------|------|-------------|
| `create-room` | - | Create a new room |
| `join-room` | `{ room, name }` | Join existing room |
| `leave-room` | `{ room }` | Leave current room |
| `video-change` | `{ room, videoId }` | Change video (host only) |
| `player-state-change` | `{ room, state, timestamp }` | Update playback state |
| `sync-time` | `{ room, timestamp, state }` | Sync playback time |
| `chat-message` | `{ room, message }` | Send chat message |
| `ping` | `timestamp` | Check latency |

### Server to Client

| Event | Data | Description |
|-------|------|-------------|
| `room-created` | `{ room }` | Room created successfully |
| `room-joined` | `{ room, users, currentVideo }` | Joined room successfully |
| `room-join-error` | `{ message }` | Failed to join room |
| `user-joined` | `{ user, users }` | User joined room |
| `user-left` | `{ user, users }` | User left room |
| `video-changed` | `{ videoId }` | Video changed by host |
| `player-state-change` | `{ state, timestamp }` | Playback state updated |
| `sync-time` | `{ timestamp, state }` | Time sync from host |
| `chat-message` | `{ user, message, timestamp }` | New chat message |
| `host-changed` | `{ newHost, users }` | New host assigned |
| `pong` | `timestamp` | Latency response |

## 🎨 Customization

### Changing Colors

Edit the CSS variables in `frontend/style.css`:

```css
:root {
    --primary: #00d4ff;        /* Cyan */
    --accent: #8338ec;         /* Purple */
    --success: #06ffa5;        /* Mint */
    --danger: #ff006e;         /* Pink */
    --warning: #ffbe0b;        /* Yellow */
}
```

### Room Limits

Adjust room capacity in `server.js`:

```javascript
// Line 67
if (roomData.users.size >= 50) {  // Change 50 to your desired limit
    socket.emit('room-join-error', { message: 'Room is full' });
    return;
}
```

### Sync Interval

Change sync frequency in `frontend/script.js`:

```javascript
// Line 148
syncInterval = setInterval(() => {
    // ...
}, 3000);  // Change 3000 (3 seconds) to your preferred interval
```

## 🌐 Deployment

### Render.com

1. Push code to GitHub
2. Connect repository to Render
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Deploy!

### Heroku

```bash
heroku create syncjam-app
git push heroku main
heroku open
```

### VPS (Manual)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/yourusername/syncjam.git
cd syncjam
npm install

# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name syncjam
pm2 save
pm2 startup
```

## 🔒 Security Considerations

- Rooms are temporary and auto-delete when empty
- No user data is permanently stored
- Room codes are randomly generated (36^6 = 2+ billion combinations)
- CORS enabled for flexibility (restrict in production)
- Rate limiting recommended for production
- Consider adding authentication for persistent rooms

## 🐛 Troubleshooting

### Videos won't load
- Ensure YouTube IFrame API is accessible
- Check browser console for errors
- Verify video ID is valid
- Some videos may be region-restricted or embeddable-disabled

### Sync issues
- Check network latency
- Ensure only host is controlling playback
- Try refreshing the page
- Check console for WebSocket errors

### Connection problems
- Verify server is running on correct port
- Check firewall settings
- Ensure WebSocket protocol is allowed
- Try different browser

## 📝 License

This project is licensed under the MIT License - see below for details:

```
MIT License

Copyright (c) 2025 SyncJam Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Contact

Project Link: [https://github.com/yourusername/syncjam](https://github.com/yourusername/syncjam)

## 🙏 Acknowledgments

- [Socket.IO](https://socket.io/) - Real-time engine
- [Express.js](https://expressjs.com/) - Web framework
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference) - Video playback
- [Font Awesome](https://fontawesome.com/) - Icons
- [Google Fonts](https://fonts.google.com/) - Poppins font

---

[Report Bug](https://github.com/yourusername/syncjam/issues) | [Request Feature](https://github.com/yourusername/syncjam/issues)