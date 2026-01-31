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
    }
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

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
            audioOnly: false,
            createdAt: Date.now(),
            votes: new Map() // Track votes for songs
        });

        // Add host to room
        const room = rooms.get(roomCode);
        const userName = username || 'Host';
        room.users.set(socket.id, {
            id: socket.id,
            name: userName,
            isHost: true,
            joinedAt: Date.now(),
            volume: 100
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

        // Validate and ensure unique username
        const baseName = (username || `User${roomData.users.size + 1}`).trim().substring(0, 20);
        let finalName = baseName;
        let counter = 1;
        
        const allNames = Array.from(roomData.users.values()).map(u => u.name.toLowerCase());
        while (allNames.includes(finalName.toLowerCase())) {
            finalName = `${baseName}${counter}`;
            counter++;
        }

        // Add user to room
        roomData.users.set(socket.id, {
            id: socket.id,
            name: finalName,
            isHost: false,
            joinedAt: Date.now(),
            volume: 100
        });

        socket.join(room);

        // Notify the user who joined
        socket.emit('room-joined', {
            room,
            username: finalName,
            users: Array.from(roomData.users.values()),
            playlist: roomData.playlist,
            currentVideo: roomData.currentVideo,
            playbackState: roomData.playbackState,
            playbackTime: roomData.playbackTime,
            audioOnly: roomData.audioOnly,
            isHost: false
        });

        // Notify other users in the room
        socket.to(room).emit('user-joined', {
            user: { id: socket.id, name: finalName },
            users: Array.from(roomData.users.values())
        });

        console.log(`${finalName} (${socket.id}) joined room: ${room}`);
    });

    // Update username
    socket.on('update-username', (data) => {
        const { room, username } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                const oldName = user.name;
                const newName = username.trim().substring(0, 20);
                
                // Check for duplicate names (case insensitive)
                const allNames = Array.from(roomData.users.values())
                    .filter(u => u.id !== socket.id)
                    .map(u => u.name.toLowerCase());
                
                if (allNames.includes(newName.toLowerCase())) {
                    socket.emit('username-error', { message: 'Username already taken' });
                    return;
                }

                user.name = newName;
                
                // Notify all users in room
                io.to(room).emit('username-updated', {
                    userId: socket.id,
                    oldName,
                    newName,
                    users: Array.from(roomData.users.values())
                });

                console.log(`${oldName} changed username to ${newName} in room ${room}`);
            }
        }
    });

    // Leave room
    socket.on('leave-room', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                // Remove user from room
                roomData.users.delete(socket.id);
                socket.leave(room);

                // Remove user's votes
                roomData.votes.forEach((votes, videoId) => {
                    roomData.votes.set(videoId, votes.filter(id => id !== socket.id));
                });

                // Notify other users
                socket.to(room).emit('user-left', {
                    user,
                    users: Array.from(roomData.users.values())
                });

                // If room is empty, delete it
                if (roomData.users.size === 0) {
                    rooms.delete(room);
                    console.log(`Room ${room} deleted (empty)`);
                }
                // If host left, assign new host
                else if (user.isHost) {
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

            // Check if sender is the host
            if (roomData.host === socket.id) {
                roomData.currentVideo = { videoId, title, duration };
                roomData.playbackState = 'paused';
                roomData.playbackTime = 0;

                // Broadcast to all other users in room
                socket.to(room).emit('video-changed', { videoId, title, duration });
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

            // Check if collaborative playlist is enabled or user is host
            if (user && (user.isHost || roomData.collaborativePlaylist)) {
                const videoData = {
                    id: videoId,
                    title: title || `Video ${videoId}`,
                    duration: duration || 0,
                    addedBy: addedBy || user.name,
                    addedById: socket.id,
                    addedAt: Date.now(),
                    votes: new Set()
                };

                roomData.playlist.push(videoData);
                roomData.votes.set(videoId, []);

                // Broadcast to all users in room
                io.to(room).emit('playlist-updated', {
                    playlist: roomData.playlist,
                    addedVideo: videoData
                });

                console.log(`${user.name} added ${videoId} to playlist in room ${room}`);
                
                // If no current video and playlist was empty, play this video
                if (!roomData.currentVideo && roomData.playlist.length === 1) {
                    roomData.currentVideo = videoData;
                    io.to(room).emit('video-changed', { 
                        videoId, 
                        title: videoData.title,
                        duration: videoData.duration 
                    });
                }
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
                const index = roomData.playlist.findIndex(v => v.id === videoId);
                if (index !== -1) {
                    roomData.playlist.splice(index, 1);
                    roomData.votes.delete(videoId);

                    // Broadcast to all users in room
                    io.to(room).emit('playlist-updated', {
                        playlist: roomData.playlist,
                        removedVideo: videoId
                    });

                    console.log(`${user.name} removed ${videoId} from playlist in room ${room}`);
                }
            }
        }
    });

    // Reorder playlist
    socket.on('reorder-playlist', (data) => {
        const { room, fromIndex, toIndex } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                const [movedVideo] = roomData.playlist.splice(fromIndex, 1);
                roomData.playlist.splice(toIndex, 0, movedVideo);

                // Broadcast to all users in room
                io.to(room).emit('playlist-updated', {
                    playlist: roomData.playlist,
                    reordered: true
                });

                console.log(`${user.name} reordered playlist in room ${room}`);
            }
        }
    });

    // Vote for song
    socket.on('vote-song', (data) => {
        const { room, videoId, vote } = data; // vote: 'like' or 'dislike'

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && roomData.votes.has(videoId)) {
                const votes = roomData.votes.get(videoId);
                const userVoteIndex = votes.findIndex(v => v.userId === socket.id);

                if (userVoteIndex !== -1) {
                    votes.splice(userVoteIndex, 1);
                }

                if (vote !== 'remove') {
                    votes.push({ userId: socket.id, vote, timestamp: Date.now() });
                }

                // Broadcast updated votes
                io.to(room).emit('votes-updated', {
                    videoId,
                    votes
                });

                console.log(`${user.name} voted ${vote} for ${videoId} in room ${room}`);
            }
        }
    });

    // Next video
    socket.on('next-video', (data) => {
        const { room } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost && roomData.playlist.length > 0) {
                const currentIndex = roomData.playlist.findIndex(v => v.id === roomData.currentVideo?.id);
                let nextIndex = (currentIndex + 1) % roomData.playlist.length;
                
                // Optional: Get most voted song
                if (roomData.voteMode === 'popularity') {
                    const votesByVideo = new Map();
                    roomData.votes.forEach((votes, videoId) => {
                        const likeCount = votes.filter(v => v.vote === 'like').length;
                        const dislikeCount = votes.filter(v => v.vote === 'dislike').length;
                        votesByVideo.set(videoId, likeCount - dislikeCount);
                    });
                    
                    // Find video with highest score that's not current
                    let maxScore = -Infinity;
                    roomData.playlist.forEach((video, index) => {
                        if (video.id !== roomData.currentVideo?.id) {
                            const score = votesByVideo.get(video.id) || 0;
                            if (score > maxScore) {
                                maxScore = score;
                                nextIndex = index;
                            }
                        }
                    });
                }

                const nextVideo = roomData.playlist[nextIndex];
                roomData.currentVideo = nextVideo;
                roomData.playbackState = 'paused';
                roomData.playbackTime = 0;

                // Broadcast to all users in room
                io.to(room).emit('video-changed', {
                    videoId: nextVideo.id,
                    title: nextVideo.title,
                    duration: nextVideo.duration
                });

                console.log(`Next video played in room ${room}: ${nextVideo.id}`);
            }
        }
    });

    // Player state change
    socket.on('player-state-change', (data) => {
        const { room, state, timestamp } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            // Check if sender is the host
            if (roomData.host === socket.id) {
                roomData.playbackState = state;
                roomData.playbackTime = timestamp || 0;

                // Broadcast to all other users in room
                socket.to(room).emit('player-state-change', { state, timestamp });
                console.log(`Player state in room ${room}: ${state} at ${timestamp}s`);
            }
        }
    });

    // Time synchronization with latency compensation
    socket.on('sync-time', (data) => {
        const { room, timestamp, state, clientTime } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);

            // Check if sender is the host
            if (roomData.host === socket.id) {
                const serverTime = Date.now();
                const latency = serverTime - clientTime;
                
                roomData.playbackTime = timestamp;
                roomData.playbackState = state;
                roomData.lastSync = {
                    timestamp,
                    serverTime,
                    latency
                };

                // Broadcast to all other users in room with compensation
                socket.to(room).emit('sync-time', { 
                    timestamp, 
                    state,
                    serverTime,
                    latency 
                });
            }
        }
    });

    // Update user volume
    socket.on('update-volume', (data) => {
        const { room, volume } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user) {
                user.volume = Math.max(0, Math.min(100, volume));
                
                // Broadcast to user only (or to host for monitoring)
                socket.emit('volume-updated', { volume: user.volume });
                
                console.log(`${user.name} volume set to ${user.volume}% in room ${room}`);
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
                
                // Broadcast to all users in room
                io.to(room).emit('audio-only-changed', { audioOnly });
                
                console.log(`Audio-only mode ${audioOnly ? 'enabled' : 'disabled'} in room ${room}`);
            }
        }
    });

    // Update room settings
    socket.on('update-room-settings', (data) => {
        const { room, settings } = data;

        if (rooms.has(room)) {
            const roomData = rooms.get(room);
            const user = roomData.users.get(socket.id);

            if (user && user.isHost) {
                // Update settings
                roomData.collaborativePlaylist = settings.collaborativePlaylist || false;
                roomData.voteMode = settings.voteMode || 'sequential';
                roomData.autoPlayNext = settings.autoPlayNext !== false;
                
                // Broadcast to all users in room
                io.to(room).emit('room-settings-updated', { settings: {
                    collaborativePlaylist: roomData.collaborativePlaylist,
                    voteMode: roomData.voteMode,
                    autoPlayNext: roomData.autoPlayNext
                }});
                
                console.log(`Room settings updated in room ${room}`);
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

                // Broadcast to all users in room (including sender)
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

        // Remove user from all rooms
        rooms.forEach((roomData, roomCode) => {
            if (roomData.users.has(socket.id)) {
                const user = roomData.users.get(socket.id);

                // Remove user from room
                roomData.users.delete(socket.id);

                // Remove user's votes
                roomData.votes.forEach((votes, videoId) => {
                    roomData.votes.set(videoId, votes.filter(v => v.userId !== socket.id));
                });

                // Notify other users
                io.to(roomCode).emit('user-left', {
                    user,
                    users: Array.from(roomData.users.values())
                });

                // If room is empty, delete it
                if (roomData.users.size === 0) {
                    rooms.delete(roomCode);
                    console.log(`Room ${roomCode} deleted (empty)`);
                }
                // If host disconnected, assign new host
                else if (user.isHost && roomData.users.size > 0) {
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

// Cleanup empty rooms periodically (every hour)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    rooms.forEach((roomData, roomCode) => {
        // Delete rooms older than 24 hours
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
            host: roomData.host,
            playlistLength: roomData.playlist.length,
            currentVideo: roomData.currentVideo?.id,
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
    console.log(`📊 API Health check: http://localhost:${PORT}/api/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/api/stats`);
});