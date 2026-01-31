// Global variables
let socket;
let player;
let currentRoom = null;
let isHost = false;
let users = [];
let currentVideoId = null;
let syncInterval;
let lastSyncTime = Date.now();
let playlist = [];
let audioOnly = false;
let visualizerContext;
let username = null;
let latency = 0;
let roomSettings = {
    collaborativePlaylist: false,
    autoPlayNext: true,
    voteMode: 'sequential'
};

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
const songInfo = document.getElementById('song-info');
const audioOnlyBtn = document.getElementById('audio-only-btn');
const audioModeIndicator = document.getElementById('audio-mode');
const audioVisualizer = document.getElementById('audio-visualizer');
const visualizerCanvas = document.getElementById('visualizer-canvas');
const songInfoAudio = document.getElementById('song-info-audio');
const playlistSection = document.getElementById('playlist-section');
const playlistList = document.getElementById('playlist-list');
const clearPlaylistBtn = document.getElementById('clear-playlist-btn');
const shufflePlaylistBtn = document.getElementById('shuffle-playlist-btn');
const usersList = document.getElementById('users-list');
const changeUsernameBtn = document.getElementById('change-username-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const connectionStatus = document.getElementById('connection-status');
const syncStatus = document.getElementById('sync-status');
const syncStatusText = document.getElementById('sync-status-text');
const latencyInfo = document.getElementById('latency-info');
const latencyValue = document.getElementById('latency-value');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const collaborativePlaylistToggle = document.getElementById('collaborative-playlist');
const autoPlayNextToggle = document.getElementById('auto-play-next');
const voteModeRadios = document.querySelectorAll('input[name="vote-mode"]');
const saveSettingsBtn = document.getElementById('save-settings');
const changeUsernameModal = document.getElementById('change-username-modal');
const newUsernameInput = document.getElementById('new-username-input');
const saveUsernameBtn = document.getElementById('save-username');
const roomCreatedModal = document.getElementById('room-created-modal');
const newRoomCode = document.getElementById('new-room-code');
const copyModalCodeBtn = document.getElementById('copy-modal-code');

// State variables for voting
const userVotes = new Map(); // videoId -> 'like' | 'dislike'
let currentPlaylistItemId = null;
let pendingJoinData = null;

// Initialize YouTube Player
function initYouTubePlayer() {
    player = new YT.Player('player', {
        height: '400',
        width: '100%',
        playerVars: {
            'autoplay': 0,
            'controls': 0, // Hide YouTube controls for custom ones
            'rel': 0,
            'showinfo': 0,
            'modestbranding': 1,
            'iv_load_policy': 3,
            'disablekb': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

// YouTube API Callback
function onYouTubeIframeAPIReady() {
    initYouTubePlayer();
    initVisualizer();
}

function onPlayerReady(event) {
    console.log('YouTube player ready');
    event.target.setVolume(80);
    
    // Update volume slider to match player
    volumeSlider.value = player.getVolume();
    
    // Start sync interval if in a room
    if (currentRoom) {
        startSyncInterval();
    }
}

function onPlayerStateChange(event) {
    if (!currentRoom) return;
    
    const state = event.data;
    const currentTime = player.getCurrentTime();
    const videoId = player.getVideoData()?.video_id;
    
    // Update visualizer for audio-only mode
    if (audioOnly && state === YT.PlayerState.PLAYING) {
        startVisualizer();
    } else if (audioOnly && (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED)) {
        stopVisualizer();
    }
    
    // If video ended and auto-play next is enabled
    if (state === YT.PlayerState.ENDED && roomSettings.autoPlayNext && isHost && playlist.length > 0) {
        setTimeout(() => {
            socket.emit('next-video', { room: currentRoom });
        }, 1000);
    }
    
    // Broadcast state changes to room (only if host)
    if (isHost && videoId) {
        if (state === YT.PlayerState.PLAYING) {
            socket.emit('player-state-change', {
                room: currentRoom,
                state: 'playing',
                timestamp: currentTime
            });
        } else if (state === YT.PlayerState.PAUSED) {
            socket.emit('player-state-change', {
                room: currentRoom,
                state: 'paused',
                timestamp: currentTime
            });
        }
    }
}

function onPlayerError(event) {
    showToast('Error', 'Failed to load video. Please check the URL.', 'error');
    console.error('YouTube player error:', event);
}

// Audio Visualizer
function initVisualizer() {
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;
    visualizerContext = visualizerCanvas.getContext('2d');
    
    // Handle window resize
    window.addEventListener('resize', () => {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    });
}

function startVisualizer() {
    if (!visualizerContext) return;
    
    const draw = () => {
        if (!player || player.getPlayerState() !== YT.PlayerState.PLAYING) {
            stopVisualizer();
            return;
        }
        
        // Clear canvas
        visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        
        // Create gradient
        const gradient = visualizerContext.createLinearGradient(0, 0, visualizerCanvas.width, 0);
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.1)');
        gradient.addColorStop(0.5, 'rgba(131, 56, 236, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 212, 255, 0.1)');
        
        // Draw waveform effect
        const time = Date.now() / 1000;
        const amplitude = 50;
        const frequency = 0.02;
        const segments = 100;
        
        visualizerContext.beginPath();
        visualizerContext.moveTo(0, visualizerCanvas.height / 2);
        
        for (let i = 0; i <= segments; i++) {
            const x = (i / segments) * visualizerCanvas.width;
            const y = visualizerCanvas.height / 2 + 
                Math.sin(time * 2 + i * frequency) * amplitude * 
                Math.sin(i * Math.PI / segments) * 
                (0.5 + 0.5 * Math.sin(time));
            
            visualizerContext.lineTo(x, y);
        }
        
        visualizerContext.lineTo(visualizerCanvas.width, visualizerCanvas.height);
        visualizerContext.lineTo(0, visualizerCanvas.height);
        visualizerContext.closePath();
        
        visualizerContext.fillStyle = gradient;
        visualizerContext.fill();
        
        // Draw audio bars
        const barCount = 60;
        const barWidth = visualizerCanvas.width / barCount;
        const barSpacing = 2;
        
        for (let i = 0; i < barCount; i++) {
            const barHeight = 20 + Math.sin(time * 3 + i * 0.3) * 30 + 
                Math.cos(time * 2 + i * 0.2) * 20;
            const x = i * barWidth;
            const y = visualizerCanvas.height - barHeight;
            
            visualizerContext.fillStyle = `rgba(${100 + i * 2}, ${150 + i}, ${255}, ${0.5 + 0.3 * Math.sin(time + i * 0.1)})`;
            visualizerContext.fillRect(x + barSpacing, y, barWidth - barSpacing * 2, barHeight);
        }
        
        requestAnimationFrame(draw);
    };
    
    draw();
}

function stopVisualizer() {
    if (visualizerContext) {
        visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    }
}

function toggleAudioOnly() {
    audioOnly = !audioOnly;
    
    if (audioOnly) {
        // Hide video player, show visualizer
        document.getElementById('player').style.display = 'none';
        audioVisualizer.style.display = 'block';
        audioModeIndicator.style.display = 'flex';
        audioOnlyBtn.innerHTML = '<i class="fas fa-video"></i>';
        audioOnlyBtn.title = 'Show Video';
        
        // Update song info in visualizer
        const videoData = player.getVideoData();
        if (videoData && videoData.title) {
            songInfoAudio.querySelector('.song-title').textContent = videoData.title;
            songInfoAudio.querySelector('.song-details').textContent = videoData.author || 'YouTube';
        }
        
        // Start visualizer if playing
        if (player.getPlayerState() === YT.PlayerState.PLAYING) {
            startVisualizer();
        }
    } else {
        // Show video player, hide visualizer
        document.getElementById('player').style.display = 'block';
        audioVisualizer.style.display = 'none';
        audioModeIndicator.style.display = 'none';
        audioOnlyBtn.innerHTML = '<i class="fas fa-music"></i>';
        audioOnlyBtn.title = 'Audio Only Mode';
        stopVisualizer();
    }
    
    // Notify server if host
    if (isHost && currentRoom) {
        socket.emit('toggle-audio-only', {
            room: currentRoom,
            audioOnly: audioOnly
        });
    }
}

// Initialize Socket.io connection
function initSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    // Connection status
    socket.on('connect', () => {
        updateConnectionStatus(true);
        console.log('Connected to server');
        
        // If we have pending join data, try to join
        if (pendingJoinData) {
            const { room, username, isCreate } = pendingJoinData;
            if (isCreate) {
                socket.emit('create-room', { username });
            } else {
                socket.emit('join-room', { room, username });
            }
            pendingJoinData = null;
        }
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        console.log('Disconnected from server');
    });
    
    socket.on('connect_error', (error) => {
        showToast('Connection Error', 'Unable to connect to server', 'error');
        console.error('Connection error:', error);
        pendingJoinData = null;
    });
    
    // Room events
    socket.on('room-created', (data) => {
        currentRoom = data.room;
        username = data.username;
        isHost = true;
        newRoomCode.textContent = currentRoom;
        showRoomCreatedModal();
        switchToRoomView();
        updateRoomCode(currentRoom);
        updateUserList([{ id: socket.id, name: username, isHost: true, volume: 100 }]);
        showToast('Success', `Room ${currentRoom} created!`, 'success');
    });
    
    socket.on('room-joined', (data) => {
        currentRoom = data.room;
        username = data.username;
        isHost = data.isHost;
        switchToRoomView();
        updateRoomCode(currentRoom);
        updateUserList(data.users);
        playlist = data.playlist || [];
        audioOnly = data.audioOnly || false;
        roomSettings.collaborativePlaylist = data.collaborativePlaylist || false;
        roomSettings.autoPlayNext = data.autoPlayNext !== false;
        roomSettings.voteMode = data.voteMode || 'sequential';
        
        // Update UI based on settings
        updateSettingsUI();
        
        // Update audio mode
        if (audioOnly) {
            toggleAudioOnly();
        }
        
        // Update playlist
        updatePlaylistUI();
        
        // If there's a video playing, sync with it
        if (data.currentVideo) {
            loadVideo(data.currentVideo.videoId, data.currentVideo.title, data.currentVideo.duration);
        }
        
        // If playback state is available, sync with it
        if (data.playbackState && data.playbackTime !== undefined) {
            setTimeout(() => {
                if (player && player.getPlayerState) {
                    if (data.playbackState === 'playing') {
                        player.playVideo();
                        syncVideoTime(data.playbackTime);
                    } else {
                        player.pauseVideo();
                        syncVideoTime(data.playbackTime);
                    }
                }
            }, 1000);
        }
        
        showToast('Success', `Joined room ${currentRoom} as ${username}`, 'success');
    });
    
    socket.on('room-join-error', (data) => {
        showToast('Error', data.message, 'error');
        pendingJoinData = null;
    });
    
    socket.on('username-error', (data) => {
        showToast('Error', data.message, 'error');
    });
    
    socket.on('user-joined', (data) => {
        updateUserList(data.users);
        showToast('Info', `${data.user.name} joined the room`, 'success');
        addSystemMessage(`${data.user.name} joined the room`);
    });
    
    socket.on('user-left', (data) => {
        updateUserList(data.users);
        showToast('Info', `${data.user.name} left the room`, 'warning');
        addSystemMessage(`${data.user.name} left the room`);
    });
    
    socket.on('username-updated', (data) => {
        if (data.userId === socket.id) {
            username = data.newName;
            showToast('Success', `Username changed to ${username}`, 'success');
        }
        updateUserList(data.users);
        addSystemMessage(`${data.oldName} changed username to ${data.newName}`);
    });
    
    // Video synchronization events
    socket.on('video-changed', (data) => {
        if (!isHost && data.videoId) {
            loadVideo(data.videoId, data.title, data.duration);
        }
    });
    
    socket.on('player-state-change', (data) => {
        if (!isHost && player && player.getPlayerState) {
            if (data.state === 'playing') {
                player.playVideo();
                syncVideoTime(data.timestamp);
            } else if (data.state === 'paused') {
                player.pauseVideo();
                syncVideoTime(data.timestamp);
            }
        }
    });
    
    socket.on('sync-time', (data) => {
        if (!isHost && player) {
            // Calculate compensated time based on latency
            const now = Date.now();
            const timeSinceSync = now - data.serverTime;
            const compensatedTime = data.timestamp + (timeSinceSync / 1000);
            
            syncVideoTime(compensatedTime);
            
            // Update latency display
            latency = data.latency || 0;
            updateLatency(latency);
        }
    });
    
    // Playlist events
    socket.on('playlist-updated', (data) => {
        playlist = data.playlist || [];
        updatePlaylistUI();
        
        if (data.addedVideo) {
            addSystemMessage(`${data.addedVideo.addedBy} added "${data.addedVideo.title}" to playlist`);
        } else if (data.removedVideo) {
            addSystemMessage(`Song removed from playlist`);
        }
    });
    
    socket.on('votes-updated', (data) => {
        updateVotesUI(data.videoId, data.votes);
    });
    
    // Volume events
    socket.on('volume-updated', (data) => {
        // Individual volume control for this user
        if (player) {
            player.setVolume(data.volume);
            volumeSlider.value = data.volume;
        }
    });
    
    // Audio-only mode
    socket.on('audio-only-changed', (data) => {
        if (audioOnly !== data.audioOnly) {
            audioOnly = data.audioOnly;
            if (audioOnly) {
                document.getElementById('player').style.display = 'none';
                audioVisualizer.style.display = 'block';
                audioModeIndicator.style.display = 'flex';
                if (player.getPlayerState() === YT.PlayerState.PLAYING) {
                    startVisualizer();
                }
            } else {
                document.getElementById('player').style.display = 'block';
                audioVisualizer.style.display = 'none';
                audioModeIndicator.style.display = 'none';
                stopVisualizer();
            }
        }
    });
    
    // Room settings
    socket.on('room-settings-updated', (data) => {
        roomSettings = { ...roomSettings, ...data.settings };
        updateSettingsUI();
        showToast('Settings Updated', 'Room settings have been updated', 'info');
    });
    
    // Chat events
    socket.on('chat-message', (data) => {
        addChatMessage(data.user, data.message, data.timestamp);
    });
    
    // Latency test
    socket.on('pong', (timestamp) => {
        const newLatency = Date.now() - timestamp;
        latency = newLatency;
        updateLatency(latency);
        
        // Adjust sync based on latency
        if (latency > 100) {
            syncStatusText.textContent = 'Lagging';
            syncStatus.style.color = 'var(--warning)';
        } else if (latency > 50) {
            syncStatusText.textContent = 'Good';
            syncStatus.style.color = 'var(--success)';
        } else {
            syncStatusText.textContent = 'Excellent';
            syncStatus.style.color = 'var(--primary)';
        }
    });
}

// Room Management
function createRoom() {
    const username = hostUsernameInput.value.trim() || getRandomUserName();
    if (!username) {
        showToast('Error', 'Please enter a username', 'error');
        return;
    }
    
    if (socket.connected) {
        socket.emit('create-room', { username });
    } else {
        pendingJoinData = { username, isCreate: true };
        showToast('Connecting', 'Connecting to server...', 'info');
    }
}

function joinRoom() {
    const code = roomCodeInput.value.trim().toUpperCase();
    const username = getRandomUserName();
    
    if (!code || code.length !== 6) {
        showToast('Error', 'Please enter a valid 6-character room code', 'error');
        return;
    }
    
    // Show username modal for joining users
    showUsernameModal(code, username, false);
}

function showUsernameModal(roomCode, defaultUsername, isCreate) {
    usernameModal.classList.add('active');
    usernameInput.value = defaultUsername;
    usernameInput.focus();
    
    const joinHandler = () => {
        const username = usernameInput.value.trim() || defaultUsername;
        if (!username) {
            showToast('Error', 'Please enter a username', 'error');
            return;
        }
        
        usernameModal.classList.remove('active');
        
        if (socket.connected) {
            if (isCreate) {
                socket.emit('create-room', { username });
            } else {
                socket.emit('join-room', { room: roomCode, username });
            }
        } else {
            pendingJoinData = { room: roomCode, username, isCreate };
            showToast('Connecting', 'Connecting to server...', 'info');
        }
    };
    
    submitUsernameBtn.onclick = joinHandler;
    usernameInput.onkeypress = (e) => {
        if (e.key === 'Enter') joinHandler();
    };
}

function leaveRoom() {
    if (currentRoom) {
        socket.emit('leave-room', { room: currentRoom });
        currentRoom = null;
        isHost = false;
        username = null;
        switchToConnectionView();
        stopSyncInterval();
        stopVisualizer();
        
        // Reset player
        if (player) {
            player.stopVideo();
        }
        
        showToast('Info', 'Left the room', 'warning');
    }
}

// Video Management
function loadVideo(videoId, title, duration) {
    if (!videoId) return;
    
    const videoData = {
        videoId,
        title: title || `Video ${videoId}`,
        duration: duration || 0
    };
    
    currentVideoId = videoId;
    
    if (player) {
        player.loadVideoById(videoId);
        
        // Update song info
        updateSongInfo(videoData);
        
        // If host, broadcast to room
        if (isHost && currentRoom) {
            socket.emit('video-change', {
                room: currentRoom,
                ...videoData
            });
        }
        
        // Highlight current song in playlist
        updateCurrentPlaylistItem(videoId);
    }
}

function addToPlaylist(videoId, title, duration) {
    if (!videoId || !currentRoom) return;
    
    const videoData = {
        videoId,
        title: title || `Video ${videoId}`,
        duration: duration || 0,
        addedBy: username
    };
    
    socket.emit('add-to-playlist', {
        room: currentRoom,
        ...videoData
    });
}

function extractVideoId(url) {
    // If it's already a video ID (11 characters)
    if (url.length === 11 && !url.includes('/') && !url.includes('?')) {
        return { id: url, title: null, duration: 0 };
    }
    
    // Try to extract from various YouTube URL formats
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? { id: match[1], title: null, duration: 0 } : null;
}

// Synchronization
function startSyncInterval() {
    if (syncInterval) clearInterval(syncInterval);
    
    syncInterval = setInterval(() => {
        if (isHost && player && currentRoom && currentVideoId) {
            const currentTime = player.getCurrentTime();
            const playerState = player.getPlayerState();
            
            // Broadcast sync time every 2 seconds with latency compensation
            if (Date.now() - lastSyncTime > 2000) {
                socket.emit('sync-time', {
                    room: currentRoom,
                    timestamp: currentTime,
                    state: playerState === 1 ? 'playing' : 'paused',
                    clientTime: Date.now()
                });
                lastSyncTime = Date.now();
            }
        }
    }, 100);
}

function stopSyncInterval() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

function syncVideoTime(timestamp) {
    if (player && typeof timestamp === 'number') {
        const currentTime = player.getCurrentTime();
        const diff = Math.abs(currentTime - timestamp);
        
        // Only sync if difference is significant (more than 0.5 second)
        if (diff > 0.5) {
            player.seekTo(timestamp, true);
        }
    }
}

// Playlist Management
function updatePlaylistUI() {
    if (!playlist || playlist.length === 0) {
        playlistList.innerHTML = `
            <div class="empty-playlist">
                <i class="fas fa-music"></i>
                <p>No songs in playlist. Add some to get started!</p>
            </div>
        `;
        return;
    }
    
    playlistList.innerHTML = '';
    
    playlist.forEach((video, index) => {
        const playlistItem = document.createElement('div');
        playlistItem.className = `playlist-item ${video.id === currentVideoId ? 'playing' : ''}`;
        playlistItem.dataset.videoId = video.id;
        playlistItem.draggable = isHost;
        
        // Get vote counts
        const votes = userVotes.get(video.id) || [];
        const likeCount = votes.filter(v => v.vote === 'like').length;
        const dislikeCount = votes.filter(v => v.vote === 'dislike').length;
        const userVote = votes.find(v => v.userId === socket.id)?.vote;
        
        // Format duration
        const duration = video.duration > 0 ? formatTime(video.duration) : '--:--';
        
        playlistItem.innerHTML = `
            <div class="drag-handle" style="${isHost ? '' : 'display: none;'}">
                <i class="fas fa-grip-vertical"></i>
            </div>
            <div class="song-number">${index + 1}</div>
            <div class="song-info">
                <div class="song-title" title="${video.title}">${video.title}</div>
                <div class="song-details">Added by ${video.addedBy}</div>
            </div>
            <div class="song-duration">${duration}</div>
            <div class="song-actions">
                <button class="vote-btn ${userVote === 'like' ? 'active' : ''}" 
                        onclick="voteSong('${video.id}', 'like')"
                        title="Like">
                    <i class="fas fa-thumbs-up"></i>
                </button>
                <span class="vote-count">${likeCount}</span>
                <button class="vote-btn dislike ${userVote === 'dislike' ? 'active' : ''}" 
                        onclick="voteSong('${video.id}', 'dislike')"
                        title="Dislike">
                    <i class="fas fa-thumbs-down"></i>
                </button>
                <span class="vote-count">${dislikeCount}</span>
                ${isHost ? `
                <button class="remove-btn" onclick="removeFromPlaylist('${video.id}')" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
                ` : ''}
            </div>
        `;
        
        // Add drag events for host
        if (isHost) {
            playlistItem.addEventListener('dragstart', handleDragStart);
            playlistItem.addEventListener('dragover', handleDragOver);
            playlistItem.addEventListener('drop', handleDrop);
            playlistItem.addEventListener('dragend', handleDragEnd);
        }
        
        playlistList.appendChild(playlistItem);
    });
}

function updateCurrentPlaylistItem(videoId) {
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.toggle('playing', item.dataset.videoId === videoId);
    });
}

function voteSong(videoId, vote) {
    if (!currentRoom) return;
    
    // Toggle vote if clicking same vote again
    const currentVote = userVotes.get(videoId)?.find(v => v.userId === socket.id)?.vote;
    const newVote = currentVote === vote ? 'remove' : vote;
    
    socket.emit('vote-song', {
        room: currentRoom,
        videoId,
        vote: newVote
    });
}

function removeFromPlaylist(videoId) {
    if (!currentRoom || !isHost) return;
    
    socket.emit('remove-from-playlist', {
        room: currentRoom,
        videoId
    });
}

function clearPlaylist() {
    if (!currentRoom || !isHost) return;
    
    if (confirm('Are you sure you want to clear the entire playlist?')) {
        playlist.forEach(video => {
            socket.emit('remove-from-playlist', {
                room: currentRoom,
                videoId: video.id
            });
        });
    }
}

function shufflePlaylist() {
    if (!currentRoom || !isHost || playlist.length < 2) return;
    
    // Fisher-Yates shuffle
    const shuffled = [...playlist];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Emit reorder events (simplified - in production you'd batch these)
    shuffled.forEach((video, newIndex) => {
        const oldIndex = playlist.findIndex(v => v.id === video.id);
        if (oldIndex !== newIndex) {
            socket.emit('reorder-playlist', {
                room: currentRoom,
                fromIndex: oldIndex,
                toIndex: newIndex
            });
        }
    });
}

// Drag and drop for playlist reordering
let draggedItem = null;

function handleDragStart(e) {
    if (!isHost) return;
    draggedItem = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    setTimeout(() => this.style.display = 'none', 0);
}

function handleDragOver(e) {
    if (!isHost) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
    if (!isHost || !draggedItem) return;
    e.preventDefault();
    
    const target = e.target.closest('.playlist-item');
    if (!target || target === draggedItem) return;
    
    const fromIndex = Array.from(playlistList.children).indexOf(draggedItem);
    const toIndex = Array.from(playlistList.children).indexOf(target);
    
    if (fromIndex !== toIndex) {
        socket.emit('reorder-playlist', {
            room: currentRoom,
            fromIndex,
            toIndex
        });
    }
}

function handleDragEnd() {
    if (!isHost) return;
    this.style.display = '';
    draggedItem = null;
}

function updateVotesUI(videoId, votes) {
    userVotes.set(videoId, votes);
    
    const playlistItem = document.querySelector(`.playlist-item[data-video-id="${videoId}"]`);
    if (playlistItem) {
        const likeCount = votes.filter(v => v.vote === 'like').length;
        const dislikeCount = votes.filter(v => v.vote === 'dislike').length;
        const userVote = votes.find(v => v.userId === socket.id)?.vote;
        
        const likeBtn = playlistItem.querySelector('.vote-btn:not(.dislike)');
        const dislikeBtn = playlistItem.querySelector('.vote-btn.dislike');
        const likeCountSpan = likeBtn?.nextElementSibling;
        const dislikeCountSpan = dislikeBtn?.nextElementSibling;
        
        if (likeBtn) likeBtn.classList.toggle('active', userVote === 'like');
        if (dislikeBtn) dislikeBtn.classList.toggle('active', userVote === 'dislike');
        if (likeCountSpan) likeCountSpan.textContent = likeCount;
        if (dislikeCountSpan) dislikeCountSpan.textContent = dislikeCount;
    }
}

// Settings Management
function showSettingsModal() {
    updateSettingsUI();
    settingsModal.classList.add('active');
}

function updateSettingsUI() {
    collaborativePlaylistToggle.checked = roomSettings.collaborativePlaylist;
    autoPlayNextToggle.checked = roomSettings.autoPlayNext;
    
    voteModeRadios.forEach(radio => {
        radio.checked = radio.value === roomSettings.voteMode;
    });
    
    // Update add to playlist button visibility
    addToPlaylistBtn.style.display = isHost || roomSettings.collaborativePlaylist ? 'inline-flex' : 'none';
}

function saveSettings() {
    if (!currentRoom || !isHost) return;
    
    const settings = {
        collaborativePlaylist: collaborativePlaylistToggle.checked,
        autoPlayNext: autoPlayNextToggle.checked,
        voteMode: document.querySelector('input[name="vote-mode"]:checked')?.value || 'sequential'
    };
    
    socket.emit('update-room-settings', {
        room: currentRoom,
        settings
    });
    
    settingsModal.classList.remove('active');
}

// Username Management
function showChangeUsernameModal() {
    newUsernameInput.value = username;
    changeUsernameModal.classList.add('active');
    newUsernameInput.focus();
}

function saveUsername() {
    const newUsername = newUsernameInput.value.trim();
    if (!newUsername || newUsername === username) {
        changeUsernameModal.classList.remove('active');
        return;
    }
    
    if (newUsername.length > 20) {
        showToast('Error', 'Username must be 20 characters or less', 'error');
        return;
    }
    
    socket.emit('update-username', {
        room: currentRoom,
        username: newUsername
    });
    
    changeUsernameModal.classList.remove('active');
}

// UI Updates
function switchToRoomView() {
    connectionSection.style.display = 'none';
    roomSection.style.display = 'block';
    usernameModal.classList.remove('active');
    startSyncInterval();
    
    // Show/hide host-only controls
    const hostControls = document.querySelectorAll('.host-only');
    hostControls.forEach(control => {
        control.style.display = isHost ? 'block' : 'none';
    });
}

function switchToConnectionView() {
    connectionSection.style.display = 'block';
    roomSection.style.display = 'none';
    
    // Reset UI
    youtubeUrlInput.value = '';
    currentVideoId = null;
    users = [];
    playlist = [];
    updateUserList([]);
    updatePlaylistUI();
    chatMessages.innerHTML = '<div class="system-message">Welcome to the music room! Messages are temporary and will disappear when you leave.</div>';
    
    // Reset song info
    updateSongInfo({ title: 'No song loaded', duration: 0 });
    
    // Reset audio mode
    audioOnly = false;
    audioModeIndicator.style.display = 'none';
    audioVisualizer.style.display = 'none';
    document.getElementById('player').style.display = 'block';
    stopVisualizer();
}

function updateRoomCode(code) {
    currentRoomCode.textContent = code;
}

function updateUserList(userList) {
    users = userList;
    userCount.textContent = users.length;
    
    usersList.innerHTML = '';
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.className = `user-item ${user.isHost ? 'user-host' : ''}`;
        
        const initial = user.name.charAt(0).toUpperCase();
        const displayName = user.id === socket.id ? username || 'You' : user.name;
        
        userElement.innerHTML = `
            <div class="user-avatar">${initial}</div>
            <div class="user-info">
                <div class="user-name">${displayName}${user.id === socket.id ? ' (You)' : ''}</div>
                <div class="user-volume">
                    <i class="fas fa-volume-up"></i>
                    <input type="range" class="user-volume-slider" min="0" max="100" 
                           value="${user.volume || 100}" 
                           ${user.id === socket.id ? '' : 'disabled'}
                           oninput="${user.id === socket.id ? `updateUserVolume(this.value)` : ''}">
                </div>
            </div>
            ${user.isHost ? '<div class="user-host-badge">Host</div>' : ''}
        `;
        
        usersList.appendChild(userElement);
    });
}

function updateUserVolume(volume) {
    if (!currentRoom) return;
    
    socket.emit('update-volume', {
        room: currentRoom,
        volume: parseInt(volume)
    });
}

function updateSongInfo(videoData) {
    const songTitle = document.querySelector('.song-title');
    const songDetails = document.querySelector('.song-details');
    const audioSongTitle = document.querySelector('.song-info-audio .song-title');
    const audioSongDetails = document.querySelector('.song-info-audio .song-details');
    
    if (videoData.title) {
        songTitle.textContent = videoData.title;
        songDetails.textContent = videoData.duration > 0 ? `Duration: ${formatTime(videoData.duration)}` : 'YouTube Video';
        
        if (audioOnly) {
            audioSongTitle.textContent = videoData.title;
            audioSongDetails.textContent = 'Now Playing';
        }
    } else {
        songTitle.textContent = 'No song loaded';
        songDetails.textContent = 'Add a YouTube URL to start';
    }
}

function addChatMessage(user, message, timestamp) {
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const displayName = user.id === socket.id ? 'You' : user.name;
    
    messageElement.innerHTML = `
        <div class="message-sender">${displayName}</div>
        <div class="message-text">${message}</div>
        <div class="message-time">${time}</div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'system-message';
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Utility Functions
function getRandomUserName() {
    const adjectives = ['Cool', 'Happy', 'Musical', 'Rhythmic', 'Melodic', 'Harmonic', 'Sync', 'Jam', 'Beat', 'Tune'];
    const nouns = ['Listener', 'Fan', 'Groover', 'Dancer', 'Vibes', 'Soul', 'Ears', 'Beat', 'Rhythm', 'Melody'];
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${randomAdjective} ${randomNoun}`;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showRoomCreatedModal() {
    roomCreatedModal.classList.add('active');
}

function hideRoomCreatedModal() {
    roomCreatedModal.classList.remove('active');
}

function showToast(title, message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'error' ? 'fa-exclamation-circle' : 
                 type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove toast after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s forwards';
        setTimeout(() => {
            toastContainer.removeChild(toast);
        }, 300);
    }, 5000);
}

function updateConnectionStatus(connected) {
    const icon = connectionStatus.querySelector('i');
    const text = connectionStatus.querySelector('span');
    
    if (connected) {
        icon.className = 'fas fa-circle connected';
        text.textContent = 'Connected';
    } else {
        icon.className = 'fas fa-circle disconnected';
        text.textContent = 'Disconnected';
    }
}

function updateLatency(latency) {
    latencyValue.textContent = latency;
    
    if (latency < 50) {
        latencyInfo.style.color = 'var(--success)';
    } else if (latency < 100) {
        latencyInfo.style.color = 'var(--warning)';
    } else {
        latencyInfo.style.color = 'var(--danger)';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize socket connection
    initSocket();
    
    // Username modal
    submitUsernameBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim() || getRandomUserName();
        if (!username) return;
        
        usernameModal.classList.remove('active');
        pendingJoinData = { username, isCreate: true };
    });
    
    // Room creation/joining
    createRoomBtn.addEventListener('click', () => {
        const username = hostUsernameInput.value.trim() || getRandomUserName();
        showUsernameModal(null, username, true);
    });
    
    joinRoomBtn.addEventListener('click', joinRoom);
    roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    // Room management
    leaveRoomBtn.addEventListener('click', leaveRoom);
    copyRoomCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoomCode.textContent)
            .then(() => showToast('Copied', 'Room code copied to clipboard', 'success'))
            .catch(() => showToast('Error', 'Failed to copy room code', 'error'));
    });
    
    // Video controls
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
    
    youtubeUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (e.ctrlKey || e.metaKey) {
                addToPlaylistBtn.click();
            } else {
                loadVideoBtn.click();
            }
        }
    });
    
    playPauseBtn.addEventListener('click', () => {
        if (player) {
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                player.pauseVideo();
                playPauseIcon.className = 'fas fa-play';
            } else {
                player.playVideo();
                playPauseIcon.className = 'fas fa-pause';
            }
        }
    });
    
    prevBtn.addEventListener('click', () => {
        if (isHost && currentRoom && playlist.length > 0) {
            const currentIndex = playlist.findIndex(v => v.id === currentVideoId);
            let prevIndex = currentIndex - 1;
            if (prevIndex < 0) prevIndex = playlist.length - 1;
            
            if (prevIndex >= 0) {
                const prevVideo = playlist[prevIndex];
                loadVideo(prevVideo.id, prevVideo.title, prevVideo.duration);
            }
        }
    });
    
    nextBtn.addEventListener('click', () => {
        if (isHost && currentRoom) {
            socket.emit('next-video', { room: currentRoom });
        }
    });
    
    audioOnlyBtn.addEventListener('click', toggleAudioOnly);
    
    volumeSlider.addEventListener('input', (e) => {
        if (player) {
            player.setVolume(e.target.value);
        }
    });
    
    // Progress bar
    progressBar.addEventListener('click', (e) => {
        if (player && currentVideoId) {
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const duration = player.getDuration();
            const newTime = percent * duration;
            
            player.seekTo(newTime, true);
            
            // If host, broadcast seek
            if (isHost && currentRoom) {
                socket.emit('sync-time', {
                    room: currentRoom,
                    timestamp: newTime,
                    state: player.getPlayerState() === 1 ? 'playing' : 'paused',
                    clientTime: Date.now()
                });
            }
        }
    });
    
    // Update progress bar and time display
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
    
    // Playlist controls
    clearPlaylistBtn.addEventListener('click', clearPlaylist);
    shufflePlaylistBtn.addEventListener('click', shufflePlaylist);
    
    // Settings
    settingsBtn.addEventListener('click', showSettingsModal);
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    // Username change
    changeUsernameBtn.addEventListener('click', showChangeUsernameModal);
    saveUsernameBtn.addEventListener('click', saveUsername);
    newUsernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveUsername();
    });
    
    // Chat
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // Modals
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').classList.remove('active');
        });
    });
    
    copyModalCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(newRoomCode.textContent)
            .then(() => {
                showToast('Copied', 'Room code copied to clipboard', 'success');
                hideRoomCreatedModal();
            })
            .catch(() => showToast('Error', 'Failed to copy room code', 'error'));
    });
    
    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // Test latency periodically
    setInterval(() => {
        if (socket.connected) {
            socket.emit('ping', Date.now());
        }
    }, 5000);
    
    // Auto-quality adjustment based on latency
    setInterval(() => {
        if (player && currentVideoId && latency > 200) {
            // Reduce quality if high latency
            const playbackRate = player.getPlaybackRate();
            if (playbackRate === 1) {
                player.setPlaybackRate(0.75);
                showToast('Quality Adjusted', 'Reduced playback quality due to high latency', 'warning');
            }
        }
    }, 10000);
});

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chat-message', {
            room: currentRoom,
            message: message
        });
        
        // Add message locally immediately
        addChatMessage({ id: socket.id, name: username || 'You' }, message, Date.now());
        
        chatInput.value = '';
    }
}

// Make functions available globally
window.voteSong = voteSong;
window.removeFromPlaylist = removeFromPlaylist;

// Add CSS for slideOut animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);