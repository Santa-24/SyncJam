// Global variables
let socket;
let player;
let currentRoom = null;
let isHost = false;
let users = [];
let currentVideoId = null;
let playlist = [];
let audioOnly = false;
let username = null;
let latency = 0;
let serverTimeOffset = 0; // Offset between server and client time
let syncInterval;
let lastSyncedTime = 0;
let lastSyncedState = 'paused';
let lastSyncTimestamp = 0;

// DOM Elements
const connectionSection = document.getElementById('connection-section');
const roomSection = document.getElementById('room-section');
const usernameModal = document.getElementById('username-modal');
const usernameInput = document.getElementById('username-input');
const submitUsernameBtn = document.getElementById('submit-username');
const hostUsernameInput = document.getElementById('host-username');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code');
const currentRoomCode = document.getElementById('current-room-code');
const copyRoomCodeBtn = document.getElementById('copy-room-code');
const userCount = document.getElementById('user-count');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const youtubeUrlInput = document.getElementById('youtube-url');
const loadVideoBtn = document.getElementById('load-video-btn');
const addToPlaylistBtn = document.getElementById('add-to-playlist-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const playPauseIcon = document.getElementById('play-pause-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const volumeSlider = document.getElementById('volume-slider');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const currentTimeDisplay = document.getElementById('current-time');
const durationDisplay = document.getElementById('duration');
const audioOnlyBtn = document.getElementById('audio-only-btn');
const audioVisualizer = document.getElementById('audio-visualizer');
const visualizerCanvas = document.getElementById('visualizer-canvas');
const songInfoAudio = document.getElementById('song-info-audio');
const playlistList = document.getElementById('playlist-list');
const clearPlaylistBtn = document.getElementById('clear-playlist-btn');
const shufflePlaylistBtn = document.getElementById('shuffle-playlist-btn');
const usersList = document.getElementById('users-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const connectionStatus = document.getElementById('connection-status');
const latencyInfo = document.getElementById('latency-info');
const latencyValue = document.getElementById('latency-value');
const roomCreatedModal = document.getElementById('room-created-modal');
const newRoomCode = document.getElementById('new-room-code');
const copyModalCodeBtn = document.getElementById('copy-modal-code');

let pendingJoinData = null;
let visualizerAnimationId = null;

// Initialize Socket.IO
function initSocket() {
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        updateConnectionStatus(true);
        showToast('Connected', 'Connected to server', 'success');
    });

    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        showToast('Disconnected', 'Lost connection to server', 'error');
    });

    socket.on('server-time', (data) => {
        const clientTime = Date.now();
        serverTimeOffset = data.serverTime - clientTime;
    });

    socket.on('room-created', (data) => {
        currentRoom = data.room;
        username = data.username;
        isHost = true;
        
        newRoomCode.textContent = data.room;
        roomCreatedModal.classList.add('active');
        
        switchToRoomView();
    });

    socket.on('room-joined', (data) => {
        currentRoom = data.room;
        username = data.username;
        isHost = data.isHost;
        users = data.users;
        playlist = data.playlist;
        
        // Calculate server time offset
        if (data.serverTime) {
            const clientTime = Date.now();
            serverTimeOffset = data.serverTime - clientTime;
        }
        
        switchToRoomView();
        updateUsersList(users);
        updatePlaylist(playlist);
        
        if (data.currentVideo) {
            loadVideoForClient(data.currentVideo.videoId, data.currentVideo.title, data.currentVideo.duration);
            
            // Sync to current playback position
            setTimeout(() => {
                if (data.playbackState === 'playing') {
                    player.seekTo(data.playbackTime, true);
                    player.playVideo();
                } else {
                    player.seekTo(data.playbackTime, true);
                    player.pauseVideo();
                }
            }, 500);
        }
        
        showToast('Joined', `Joined room ${data.room}`, 'success');
    });

    socket.on('room-join-error', (data) => {
        showToast('Error', data.message, 'error');
    });

    socket.on('user-joined', (data) => {
        users = data.users;
        updateUsersList(users);
        showToast('User Joined', `${data.user.name} joined the room`, 'info');
    });

    socket.on('user-left', (data) => {
        users = data.users;
        updateUsersList(users);
        showToast('User Left', `${data.user.name} left the room`, 'info');
    });

    socket.on('host-changed', (data) => {
        users = data.users;
        updateUsersList(users);
        
        if (socket.id === data.newHost) {
            isHost = true;
            showToast('You are now the host', 'You can now control playback', 'info');
        }
    });

    socket.on('video-change', (data) => {
        loadVideoForClient(data.videoId, data.title, data.duration);
    });

    socket.on('playlist-updated', (data) => {
        playlist = data.playlist;
        updatePlaylist(playlist);
    });

    socket.on('player-state-change', (data) => {
        if (isHost) return; // Host controls their own playback
        
        const serverTime = data.serverTime || Date.now() + serverTimeOffset;
        const networkDelay = (Date.now() + serverTimeOffset) - serverTime;
        
        if (data.state === 'playing') {
            // Compensate for network delay
            const adjustedTime = data.timestamp + (networkDelay / 1000);
            player.seekTo(adjustedTime, true);
            player.playVideo();
        } else if (data.state === 'paused') {
            player.seekTo(data.timestamp, true);
            player.pauseVideo();
        }
        
        updatePlayPauseButton(data.state);
    });

    socket.on('sync-time', (data) => {
        if (isHost) return;
        
        const serverTime = data.serverTime || Date.now() + serverTimeOffset;
        const networkDelay = (Date.now() + serverTimeOffset) - serverTime;
        
        // Compensate for network latency
        const adjustedTime = data.timestamp + (networkDelay / 1000);
        
        const currentTime = player.getCurrentTime();
        const timeDiff = Math.abs(currentTime - adjustedTime);
        
        // Only sync if difference is significant (> 0.5 seconds)
        if (timeDiff > 0.5) {
            player.seekTo(adjustedTime, true);
        }
        
        if (data.state === 'playing' && player.getPlayerState() !== YT.PlayerState.PLAYING) {
            player.playVideo();
        } else if (data.state === 'paused' && player.getPlayerState() === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        }
    });

    socket.on('audio-only-changed', (data) => {
        audioOnly = data.audioOnly;
        toggleAudioOnlyDisplay(audioOnly);
    });

    socket.on('chat-message', (data) => {
        addChatMessage(data.user, data.message, data.timestamp);
    });

    socket.on('pong', (timestamp) => {
        latency = Date.now() - timestamp;
        updateLatencyDisplay(latency);
    });
}

// YouTube Player
function initYouTubePlayer() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 0,
            'controls': 0,
            'rel': 0,
            'showinfo': 0,
            'modestbranding': 1,
            'iv_load_policy': 3,
            'disablekb': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onYouTubeIframeAPIReady() {
    initYouTubePlayer();
    initVisualizer();
}

function onPlayerReady(event) {
    event.target.setVolume(volumeSlider.value);
    
    if (currentRoom && isHost) {
        startSyncInterval();
    }
}

function onPlayerStateChange(event) {
    if (!currentRoom || !isHost) return;
    
    const state = event.data;
    const currentTime = player.getCurrentTime();
    
    if (audioOnly) {
        if (state === YT.PlayerState.PLAYING) {
            startVisualizer();
        } else {
            stopVisualizer();
        }
    }
    
    // Auto-play next video
    if (state === YT.PlayerState.ENDED && playlist.length > 0) {
        setTimeout(() => {
            playNextVideo();
        }, 1000);
    }
    
    // Broadcast state changes
    if (state === YT.PlayerState.PLAYING) {
        socket.emit('player-state-change', {
            room: currentRoom,
            state: 'playing',
            timestamp: currentTime
        });
        updatePlayPauseButton('playing');
    } else if (state === YT.PlayerState.PAUSED) {
        socket.emit('player-state-change', {
            room: currentRoom,
            state: 'paused',
            timestamp: currentTime
        });
        updatePlayPauseButton('paused');
    }
}

// Synchronization
function startSyncInterval() {
    if (syncInterval) clearInterval(syncInterval);
    
    // Sync every 2 seconds for smooth playback
    syncInterval = setInterval(() => {
        if (!isHost || !currentRoom || !player) return;
        
        const playerState = player.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING) {
            const currentTime = player.getCurrentTime();
            
            socket.emit('sync-time', {
                room: currentRoom,
                timestamp: currentTime,
                state: 'playing'
            });
        }
    }, 2000);
}

function stopSyncInterval() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

// Visualizer
function initVisualizer() {
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;
    
    window.addEventListener('resize', () => {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    });
}

function startVisualizer() {
    const ctx = visualizerCanvas.getContext('2d');
    const bars = 64;
    
    function draw() {
        if (!player || player.getPlayerState() !== YT.PlayerState.PLAYING) {
            stopVisualizer();
            return;
        }
        
        ctx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        
        const barWidth = visualizerCanvas.width / bars;
        const time = Date.now() / 1000;
        
        for (let i = 0; i < bars; i++) {
            const height = Math.abs(Math.sin(time + i * 0.2)) * visualizerCanvas.height * 0.5;
            const x = i * barWidth;
            const y = (visualizerCanvas.height - height) / 2;
            
            const gradient = ctx.createLinearGradient(0, y, 0, y + height);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(1, '#ec4899');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, barWidth - 2, height);
        }
        
        visualizerAnimationId = requestAnimationFrame(draw);
    }
    
    draw();
}

function stopVisualizer() {
    if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
    }
}

// Video Loading
function extractVideoId(url) {
    // Handle direct video ID
    if (url.length === 11 && !url.includes('/') && !url.includes('.')) {
        return { id: url, title: 'YouTube Video', duration: 0 };
    }
    
    // Handle YouTube URLs
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { id: match[1], title: 'YouTube Video', duration: 0 };
        }
    }
    
    return null;
}

function loadVideo(videoId, title, duration) {
    if (!isHost) {
        showToast('Permission Denied', 'Only the host can change videos', 'error');
        return;
    }
    
    currentVideoId = videoId;
    
    player.loadVideoById(videoId);
    
    socket.emit('video-change', {
        room: currentRoom,
        videoId,
        title,
        duration
    });
    
    showToast('Video Loaded', title, 'success');
}

function loadVideoForClient(videoId, title, duration) {
    currentVideoId = videoId;
    player.loadVideoById(videoId);
    
    if (audioOnly) {
        const titleEl = songInfoAudio.querySelector('.song-title');
        const artistEl = songInfoAudio.querySelector('.song-artist');
        if (titleEl) titleEl.textContent = title;
        if (artistEl) artistEl.textContent = 'YouTube';
    }
}

function addToPlaylist(videoId, title, duration) {
    socket.emit('add-to-playlist', {
        room: currentRoom,
        videoId,
        title,
        duration,
        addedBy: username
    });
    
    showToast('Added to Queue', title, 'success');
}

function removeFromPlaylist(videoId) {
    if (!isHost) {
        showToast('Permission Denied', 'Only the host can remove videos', 'error');
        return;
    }
    
    socket.emit('remove-from-playlist', {
        room: currentRoom,
        videoId
    });
}

function clearPlaylist() {
    if (!isHost) {
        showToast('Permission Denied', 'Only the host can clear the playlist', 'error');
        return;
    }
    
    socket.emit('clear-playlist', { room: currentRoom });
}

function shufflePlaylist() {
    if (!isHost) {
        showToast('Permission Denied', 'Only the host can shuffle the playlist', 'error');
        return;
    }
    
    socket.emit('shuffle-playlist', { room: currentRoom });
}

function playNextVideo() {
    if (!isHost) return;
    
    socket.emit('next-video', { room: currentRoom });
}

function playPreviousVideo() {
    if (!isHost || playlist.length === 0) return;
    
    const currentIndex = playlist.findIndex(v => v.id === currentVideoId);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
    
    if (prevIndex >= 0 && playlist[prevIndex]) {
        const video = playlist[prevIndex];
        loadVideo(video.id, video.title, video.duration);
    }
}

// UI Updates
function updatePlaylist(playlistData) {
    playlist = playlistData;
    
    if (playlist.length === 0) {
        playlistList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-music"></i>
                <p>No songs in queue</p>
                <span>Add videos to get started</span>
            </div>
        `;
        return;
    }
    
    playlistList.innerHTML = playlist.map((video, index) => `
        <div class="playlist-item ${video.id === currentVideoId ? 'playing' : ''}">
            <div class="playlist-thumbnail">
                <img src="https://img.youtube.com/vi/${video.id}/mqdefault.jpg" alt="${video.title}">
            </div>
            <div class="playlist-info">
                <div class="playlist-title">${video.title}</div>
                <div class="playlist-meta">
                    <span><i class="fas fa-user"></i> ${video.addedBy || 'Unknown'}</span>
                    ${video.votes !== undefined ? `<span><i class="fas fa-heart"></i> ${video.votes}</span>` : ''}
                </div>
            </div>
            <div class="playlist-actions">
                ${isHost ? `
                    <button class="btn-icon" onclick="removeFromPlaylist('${video.id}')" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function updateUsersList(usersData) {
    users = usersData;
    userCount.textContent = users.length;
    
    usersList.innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.name}</div>
                ${user.isHost ? '<div class="user-badge"><i class="fas fa-crown"></i> Host</div>' : ''}
            </div>
        </div>
    `).join('');
}

function addChatMessage(user, message, timestamp) {
    const isOwn = user.id === socket.id;
    const time = new Date(timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : ''}`;
    messageEl.innerHTML = `
        <div class="chat-user">${user.name}</div>
        <div class="chat-text">${escapeHtml(message)}</div>
        <div class="chat-time">${time}</div>
    `;
    
    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentRoom) return;
    
    socket.emit('chat-message', {
        room: currentRoom,
        message
    });
    
    chatInput.value = '';
}

function updateConnectionStatus(connected) {
    const statusDot = connectionStatus.querySelector('.status-dot');
    const statusText = connectionStatus.querySelector('.status-text');
    
    if (connected) {
        statusDot.classList.add('connected');
        statusDot.classList.remove('disconnected');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    }
}

function updateLatencyDisplay(ms) {
    latencyValue.textContent = `${ms}ms`;
    
    latencyInfo.classList.remove('good', 'medium', 'poor');
    if (ms < 100) {
        latencyInfo.classList.add('good');
    } else if (ms < 200) {
        latencyInfo.classList.add('medium');
    } else {
        latencyInfo.classList.add('poor');
    }
}

function updatePlayPauseButton(state) {
    if (state === 'playing') {
        playPauseIcon.className = 'fas fa-pause';
    } else {
        playPauseIcon.className = 'fas fa-play';
    }
}

function toggleAudioOnlyDisplay(enabled) {
    const playerContainer = document.getElementById('player-container');
    const playerEl = document.getElementById('player');
    
    if (enabled) {
        playerEl.style.display = 'none';
        audioVisualizer.style.display = 'block';
        if (player && player.getPlayerState() === YT.PlayerState.PLAYING) {
            startVisualizer();
        }
    } else {
        playerEl.style.display = 'block';
        audioVisualizer.style.display = 'none';
        stopVisualizer();
    }
}

function toggleAudioOnly() {
    if (!isHost) {
        showToast('Permission Denied', 'Only the host can toggle audio mode', 'error');
        return;
    }
    
    audioOnly = !audioOnly;
    
    socket.emit('toggle-audio-only', {
        room: currentRoom,
        audioOnly
    });
    
    toggleAudioOnlyDisplay(audioOnly);
}

// Room Management
function createRoom() {
    const name = hostUsernameInput.value.trim() || 'Host';
    
    socket.emit('create-room', { username: name });
}

function joinRoom() {
    const code = roomCodeInput.value.trim().toUpperCase();
    
    if (code.length !== 6) {
        showToast('Invalid Code', 'Room code must be 6 characters', 'error');
        return;
    }
    
    pendingJoinData = { room: code };
    usernameModal.classList.add('active');
}

function submitUsername() {
    if (!pendingJoinData) return;
    
    const name = usernameInput.value.trim() || 'User';
    
    socket.emit('join-room', {
        room: pendingJoinData.room,
        username: name
    });
    
    usernameModal.classList.remove('active');
    usernameInput.value = '';
    pendingJoinData = null;
}

function leaveRoom() {
    if (!currentRoom) return;
    
    socket.emit('leave-room', { room: currentRoom });
    
    stopSyncInterval();
    currentRoom = null;
    isHost = false;
    users = [];
    playlist = [];
    currentVideoId = null;
    
    if (player) {
        player.stopVideo();
    }
    
    switchToConnectionView();
    showToast('Left Room', 'You have left the room', 'info');
}

function switchToRoomView() {
    connectionSection.style.display = 'none';
    roomSection.style.display = 'block';
    currentRoomCode.textContent = currentRoom;
}

function switchToConnectionView() {
    connectionSection.style.display = 'flex';
    roomSection.style.display = 'none';
}

// Utilities
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(title, message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon"></div>
        <div class="toast-content">
            <h4>${title}</h4>
            <p>${message}</p>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    
    createRoomBtn.addEventListener('click', createRoom);
    joinRoomBtn.addEventListener('click', joinRoom);
    submitUsernameBtn.addEventListener('click', submitUsername);
    leaveRoomBtn.addEventListener('click', leaveRoom);
    
    copyRoomCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoom);
        showToast('Copied', 'Room code copied to clipboard', 'success');
    });
    
    copyModalCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(newRoomCode.textContent);
        showToast('Copied', 'Room code copied to clipboard', 'success');
        roomCreatedModal.classList.remove('active');
    });
    
    loadVideoBtn.addEventListener('click', () => {
        const url = youtubeUrlInput.value.trim();
        if (url) {
            const videoData = extractVideoId(url);
            if (videoData) {
                loadVideo(videoData.id, videoData.title, videoData.duration);
                youtubeUrlInput.value = '';
            } else {
                showToast('Error', 'Invalid YouTube URL or Video ID', 'error');
            }
        }
    });
    
    addToPlaylistBtn.addEventListener('click', () => {
        const url = youtubeUrlInput.value.trim();
        if (url) {
            const videoData = extractVideoId(url);
            if (videoData) {
                addToPlaylist(videoData.id, videoData.title, videoData.duration);
                youtubeUrlInput.value = '';
            } else {
                showToast('Error', 'Invalid YouTube URL or Video ID', 'error');
            }
        }
    });
    
    playPauseBtn.addEventListener('click', () => {
        if (!player) return;
        
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    });
    
    prevBtn.addEventListener('click', playPreviousVideo);
    nextBtn.addEventListener('click', playNextVideo);
    audioOnlyBtn.addEventListener('click', toggleAudioOnly);
    
    volumeSlider.addEventListener('input', (e) => {
        if (player) {
            player.setVolume(e.target.value);
        }
    });
    
    progressBar.addEventListener('click', (e) => {
        if (!player || !currentVideoId) return;
        
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const duration = player.getDuration();
        const newTime = percent * duration;
        
        player.seekTo(newTime, true);
        
        if (isHost) {
            socket.emit('sync-time', {
                room: currentRoom,
                timestamp: newTime,
                state: player.getPlayerState() === YT.PlayerState.PLAYING ? 'playing' : 'paused'
            });
        }
    });
    
    clearPlaylistBtn.addEventListener('click', clearPlaylist);
    shufflePlaylistBtn.addEventListener('click', shufflePlaylist);
    
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitUsername();
    });
    
    roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
    
    youtubeUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                addToPlaylistBtn.click();
            } else {
                loadVideoBtn.click();
            }
        }
    });
    
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').classList.remove('active');
        });
    });
    
    // Progress bar update
    setInterval(() => {
        if (player && currentVideoId) {
            const currentTime = player.getCurrentTime();
            const duration = player.getDuration();
            
            if (duration > 0) {
                const percent = (currentTime / duration) * 100;
                progressFill.style.width = `${percent}%`;
                currentTimeDisplay.textContent = formatTime(currentTime);
                durationDisplay.textContent = formatTime(duration);
            }
        }
    }, 100);
    
    // Latency monitoring
    setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping', Date.now());
        }
    }, 5000);
});

// Make functions globally available
window.removeFromPlaylist = removeFromPlaylist;