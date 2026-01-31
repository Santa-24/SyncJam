const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve the main HTML file for all routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// In-memory storage for rooms
const rooms = new Map();

// Generate random room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// High-precision timestamp
function getServerTime() {
    return Date.now() + process.hrtime()[1] / 1000000;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Send server time for initial sync
    socket.emit('server-time', { serverTime: getServerTime() });

    // Create a new room
    socket.on('create-room', (data) => {
        const { username } = data || {};
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (rooms.has(roomCode));

        rooms.set(roomCode, {
            host: socket.id,
            users: new Map(),
            playlist: [],
            currentVideo: null,
            playbackState: 'paused',
            playbackTime: 0,
            lastUpdateTime: getServerTime(),
            audioOnly: false,
            createdAt: Date.now(),
            votes: new Map()
        });

        const room = rooms.get(roomCode);
        const userName = username || 'Host';
        room.users.set(socket.id, {
            id: socket.id,
            name: userName,
            isHost: true,
            joinedAt: Date.now()
        });

        socket.join(roomCode);
        socket.emit('room-created', { 
            room: roomCode,
            username: userName 
        });

        console.log(`Room created: ${roomCode} by ${socket.id} (${userName})`);
    });

    // Join an existing room
    socket.on('join-room', (data) => {
        const { room, username } = data;

        if (!rooms.has(room)) {
            socket.emit('room-join-error', { message: 'Room not found' });
            return;
        }

        const roomData = rooms.get(room);

        if (roomData.users.size >= 50) {
            socket.emit('room-join-error', { message: 'Room is full' });
            return;
        }

        const baseName = (username || `User${roomData.users.size + 1}`).trim().substring(0, 20);
        let finalName = baseName;
        let counter = 1;
        
        const allNames = Array.from(roomData.users.values()).map(u => u.name.toLowerCase());
        while (allNames.includes(finalName.toLowerCase())) {
            finalName = `${baseName}${counter}`;
            counter++;
        }

        roomData.users.set(socket.id, {
            id: socket.id,
            name: finalName,
            isHost: false,
            joinedAt: Date.now()
        });

        socket.join(room);

        // Calculate current playback position if playing
        let currentTime = roomData.playbackTime;
        if (roomData.playbackState === 'playing') {
            const elapsed = (getServerTime() - roomData.lastUpdateTime) / 1000;
            currentTime += elapsed;
        }

        socket.emit('room-joined', {
            room,
            username: finalName,
            users: Array.from(roomData.users.values()),
            playlist: roomData.playlist,
            currentVideo: roomData.currentVideo,
            playbackState: roomData.playbackState,
            playbackTime: currentTime,
            serverTime: getServerTime(),
            audioOnly: roomData.audioOnly,
            isHost: false
        });

        socket.to(room).emit('user-joined', {
            user: { id: socket.id, name: finalName },
            users: Array.from(roomData.users.values())
        });

        console.log(`${finalName} (${socket.id}) joined room: ${room}`);
    });

    // Leave room
    socket.on('leave-room', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                roomData.users.delete(socket.id);
                socket.leave(room);

                roomData.votes.forEach((votes, videoId) => {
                    roomData.votes.set(videoId, votes.filter(id => id !== socket.id));
                });

                socket.to(room).emit('user-left', {
                    user,
                    users: Array.from(roomData.users.values())
                });

                if (roomData.users.size === 0) {
                    rooms.delete(room);
                    console.log(`Room ${room} deleted (empty)`);
                } else if (user.isHost) {
                    const newHost = Array.from(roomData.users.values())[0];
                    roomData.users.get(newHost.id).isHost = true;
                    roomData.host = newHost.id;

                    io.to(room).emit('host-changed', { 
                        newHost: newHost.id,
                        users: Array.from(roomData.users.values())
                    });
                    console.log(`New host for room ${room}: ${newHost.name}`);
                }

                console.log(`${user.name} (${socket.id}) left room: ${room}`);
            }
        }
    });

    // Video change
    socket.on('video-change', (data) => {
        const { room, videoId, title, duration } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            if (roomData.host === socket.id) {
                roomData.currentVideo = { videoId, title, duration };
                roomData.playbackState = 'paused';
                roomData.playbackTime = 0;
                roomData.lastUpdateTime = getServerTime();

                socket.to(room).emit('video-change', { 
                    videoId, 
                    title, 
                    duration,
                    serverTime: getServerTime()
                });
                console.log(`Video changed in room ${room}: ${videoId}`);
            }
        }
    });

    // Add to playlist
    socket.on('add-to-playlist', (data) => {
        const { room, videoId, title, duration, addedBy } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                const playlistItem = {
                    id: videoId,
                    title,
                    duration,
                    addedBy: addedBy || user.name,
                    timestamp: Date.now(),
                    votes: 0
                };

                roomData.playlist.push(playlistItem);

                io.to(room).emit('playlist-updated', { 
                    playlist: roomData.playlist 
                });

                console.log(`Video added to playlist in room ${room}: ${videoId}`);
            }
        }
    });

    // Remove from playlist
    socket.on('remove-from-playlist', (data) => {
        const { room, videoId } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                roomData.playlist = roomData.playlist.filter(v => v.id !== videoId);
                roomData.votes.delete(videoId);

                io.to(room).emit('playlist-updated', { 
                    playlist: roomData.playlist 
                });

                console.log(`Video removed from playlist in room ${room}: ${videoId}`);
            }
        }
    });

    // Vote on song
    socket.on('vote-song', (data) => {
        const { room, videoId, vote } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            
            if (!roomData.votes.has(videoId)) {
                roomData.votes.set(videoId, []);
            }

            const votes = roomData.votes.get(videoId);
            const existingVote = votes.find(v => v.userId === socket.id);

            if (existingVote) {
                if (existingVote.vote === vote) {
                    votes.splice(votes.indexOf(existingVote), 1);
                } else {
                    existingVote.vote = vote;
                }
            } else {
                votes.push({ userId: socket.id, vote });
            }

            const playlistItem = roomData.playlist.find(v => v.id === videoId);
            if (playlistItem) {
                playlistItem.votes = votes.filter(v => v.vote === 'like').length - 
                                    votes.filter(v => v.vote === 'dislike').length;
            }

            io.to(room).emit('playlist-updated', { 
                playlist: roomData.playlist 
            });
        }
    });

    // Clear playlist
    socket.on('clear-playlist', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                roomData.playlist = [];
                roomData.votes.clear();

                io.to(room).emit('playlist-updated', { 
                    playlist: [] 
                });

                console.log(`Playlist cleared in room ${room}`);
            }
        }
    });

    // Shuffle playlist
    socket.on('shuffle-playlist', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                for (let i = roomData.playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [roomData.playlist[i], roomData.playlist[j]] = [roomData.playlist[j], roomData.playlist[i]];
                }

                io.to(room).emit('playlist-updated', { 
                    playlist: roomData.playlist 
                });

                console.log(`Playlist shuffled in room ${room}`);
            }
        }
    });

    // Next video
    socket.on('next-video', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            if (roomData.host === socket.id && roomData.playlist.length > 0) {
                const nextVideo = roomData.playlist.shift();
                roomData.currentVideo = nextVideo;
                roomData.playbackState = 'playing';
                roomData.playbackTime = 0;
                roomData.lastUpdateTime = getServerTime();

                io.to(room).emit('video-change', { 
                    videoId: nextVideo.id, 
                    title: nextVideo.title, 
                    duration: nextVideo.duration,
                    serverTime: getServerTime()
                });
                
                io.to(room).emit('playlist-updated', { 
                    playlist: roomData.playlist 
                });

                io.to(room).emit('player-state-change', { 
                    state: 'playing', 
                    timestamp: 0,
                    serverTime: getServerTime()
                });

                console.log(`Next video in room ${room}: ${nextVideo.id}`);
            }
        }
    });

    // Player state change with server timestamp
    socket.on('player-state-change', (data) => {
        const { room, state, timestamp } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            if (roomData.host === socket.id) {
                const serverTime = getServerTime();
                roomData.playbackState = state;
                roomData.playbackTime = timestamp || 0;
                roomData.lastUpdateTime = serverTime;

                socket.to(room).emit('player-state-change', { 
                    state, 
                    timestamp,
                    serverTime
                });
                
                console.log(`Player state in room ${room}: ${state} at ${timestamp}s`);
            }
        }
    });

    // Precise time synchronization
    socket.on('sync-time', (data) => {
        const { room, timestamp, state } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            if (roomData.host === socket.id) {
                const serverTime = getServerTime();
                
                roomData.playbackTime = timestamp;
                roomData.playbackState = state;
                roomData.lastUpdateTime = serverTime;

                socket.to(room).emit('sync-time', { 
                    timestamp, 
                    state,
                    serverTime
                });
            }
        }
    });

    // Toggle audio-only mode
    socket.on('toggle-audio-only', (data) => {
        const { room, audioOnly } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                roomData.audioOnly = audioOnly;
                
                io.to(room).emit('audio-only-changed', { audioOnly });
                
                console.log(`Audio-only mode ${audioOnly ? 'enabled' : 'disabled'} in room ${room}`);
            }
        }
    });

    // Chat messages
    socket.on('chat-message', (data) => {
        const { room, message } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                const chatData = {
                    user: { id: user.id, name: user.name },
                    message,
                    timestamp: Date.now()
                };

                io.to(room).emit('chat-message', chatData);
            }
        }
    });

    // Ping for latency testing
    socket.on('ping', (timestamp) => {
        socket.emit('pong', timestamp);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        rooms.forEach((roomData, roomCode) => {
            if (roomData.users.has(socket.id)) {
                const user = roomData.users.get(socket.id);

                roomData.users.delete(socket.id);

                roomData.votes.forEach((votes, videoId) => {
                    roomData.votes.set(videoId, votes.filter(v => v.userId !== socket.id));
                });

                io.to(roomCode).emit('user-left', {
                    user,
                    users: Array.from(roomData.users.values())
                });

                if (roomData.users.size === 0) {
                    rooms.delete(roomCode);
                    console.log(`Room ${roomCode} deleted (empty)`);
                } else if (user.isHost && roomData.users.size > 0) {
                    const newHost = Array.from(roomData.users.values())[0];
                    roomData.users.get(newHost.id).isHost = true;
                    roomData.host = newHost.id;

                    io.to(roomCode).emit('host-changed', {
                        newHost: newHost.id,
                        users: Array.from(roomData.users.values())
                    });
                    console.log(`New host for room ${roomCode}: ${newHost.name}`);
                }

                console.log(`${user.name} (${socket.id}) disconnected from room: ${roomCode}`);
            }
        });
    });
});

// Cleanup empty rooms periodically
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    rooms.forEach((roomData, roomCode) => {
        if (now - roomData.createdAt > 24 * 60 * 60 * 1000) {
            rooms.delete(roomCode);
            cleaned++;
            console.log(`Cleaned up old room: ${roomCode}`);
        }
    });

    if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} old rooms`);
    }
}, 60 * 60 * 1000);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        rooms: rooms.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Get room stats
app.get('/api/stats', (req, res) => {
    const stats = {
        totalRooms: rooms.size,
        totalUsers: 0,
        rooms: []
    };

    rooms.forEach((roomData, roomCode) => {
        stats.totalUsers += roomData.users.size;
        stats.rooms.push({
            code: roomCode,
            users: roomData.users.size,
            playlistLength: roomData.playlist.length,
            currentVideo: roomData.currentVideo?.videoId,
            audioOnly: roomData.audioOnly,
            createdAt: roomData.createdAt
        });
    });

    res.json(stats);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ SyncJam server running on port ${PORT}`);
    console.log(`🚀 SyncJam running in production on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/api/stats`);
});