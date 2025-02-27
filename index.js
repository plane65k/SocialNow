const express = require('express');
const multer = require('multer');
const fs = require('fs').promises; // Use promises for async file ops
const path = require('path');
const app = express();

// Use Render's dynamic port
const port = process.env.PORT || 3000;

// In-memory stores with file persistence
let users = [];
let posts = [];
let messages = [];
let sessions = {};
let uploadedImages = {};

// File paths in /tmp (Render's writable directory)
const dataDir = '/tmp';
const usersFile = path.join(dataDir, 'data_users.json');
const postsFile = path.join(dataDir, 'data_posts.json');
const messagesFile = path.join(dataDir, 'data_messages.json');
const sessionsFile = path.join(dataDir, 'data_sessions.json');

// Helper functions for file persistence
async function saveData(filename, data) {
    try {
        await fs.writeFile(filename, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`Error saving ${filename}:`, err);
    }
}

async function loadData(filename, defaultValue = []) {
    try {
        const data = await fs.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return defaultValue; // Return default if file doesn’t exist
    }
}

// Load data on startup
async function initializeData() {
    users = await loadData(usersFile, []);
    posts = await loadData(postsFile, []);
    messages = await loadData(messagesFile, []);
    sessions = await loadData(sessionsFile, {});

    // Ensure root account exists
    if (!users.find(u => u.username === 'root')) {
        users.push({ 
            username: 'root', 
            password: 'rootdev', 
            profilePic: 'https://images.squarespace-cdn.com/content/v1/5936fbebcd0f68f67d5916ff/19b38924-e394-467f-9929-ca3a4f9d11bc/person-placeholder-300x300.jpeg' 
        });
        await saveData(usersFile, users);
    }
}

// Call initialization
initializeData().catch(err => console.error('Failed to initialize data:', err));

// Multer setup for in-memory image uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(express.json());
app.use(express.static('public'));

// Serve auth.html as default route
app.get('/', (req, res) => {
    res.sendFile('auth.html', { root: 'public' });
});

// Register endpoint
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (users.find(u => u.username === username)) return res.status(409).json({ error: 'Username taken' });

    users.push({ 
        username, 
        password, 
        profilePic: 'https://images.squarespace-cdn.com/content/v1/5936fbebcd0f68f67d5916ff/19b38924-e394-467f-9929-ca3a4f9d11bc/person-placeholder-300x300.jpeg' 
    });
    const sessionId = Date.now().toString();
    sessions[sessionId] = username;
    await saveData(usersFile, users);
    await saveData(sessionsFile, sessions);
    res.json({ sessionId });
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const sessionId = Date.now().toString();
    sessions[sessionId] = username;
    await saveData(sessionsFile, sessions);
    res.json({ sessionId });
});

// Authentication middleware
const authMiddleware = (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions[sessionId]) return res.status(401).json({ error: 'Unauthorized' });
    req.username = sessions[sessionId];
    next();
};

// Root-only middleware
const rootMiddleware = (req, res, next) => {
    if (req.username !== 'root') return res.status(403).json({ error: 'Forbidden: Root access only' });
    next();
};

// Get all posts
app.get('/posts', authMiddleware, (req, res) => {
    res.json(posts);
});

// Create a post with image upload
app.post('/posts', authMiddleware, upload.single('image'), async (req, res) => {
    const { caption } = req.body;
    if (!caption || (!req.file && !req.body.imageUrl)) return res.status(400).json({ error: 'Missing fields' });

    let imageUrl;
    if (req.file) {
        const imageId = Date.now().toString();
        uploadedImages[imageId] = req.file.buffer;
        imageUrl = `/uploads/${imageId}`;
    } else {
        imageUrl = req.body.imageUrl;
    }

    const post = { 
        id: Date.now(), 
        imageUrl, 
        caption, 
        username: req.username, 
        comments: [], 
        likes: 0, 
        likedBy: [] 
    };
    posts.unshift(post);
    await saveData(postsFile, posts);
    res.json(post);
});

// Serve uploaded images from memory
app.get('/uploads/:id', (req, res) => {
    const imageId = req.params.id;
    if (!uploadedImages[imageId]) return res.status(404).send('Image not found');
    res.set('Content-Type', 'image/jpeg');
    res.send(uploadedImages[imageId]);
});

// Add a comment
app.post('/posts/:id/comments', authMiddleware, async (req, res) => {
    const postId = parseInt(req.params.id);
    const { comment } = req.body;
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return res.status(400).json({ error: 'Comment cannot be empty' });
    }
    if (comment.trim().length > 500) {
        return res.status(400).json({ error: 'Comment is too long (max 500 characters)' });
    }
    const post = posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const newComment = { 
        username: req.username, 
        text: comment.trim(),
        timestamp: new Date().toISOString()
    };
    post.comments.push(newComment);
    await saveData(postsFile, posts);
    res.json(post);
});

// Like a post
app.post('/posts/:id/like', authMiddleware, async (req, res) => {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.likedBy.includes(req.username)) return res.status(400).json({ error: 'You already liked this post' });

    post.likes += 1;
    post.likedBy.push(req.username);
    await saveData(postsFile, posts);
    res.json(post);
});

// Get all chat messages
app.get('/messages', authMiddleware, (req, res) => {
    res.json(messages.filter(m => !m.recipient || m.recipient === req.username || m.sender === req.username));
});

// Send a chat message
app.post('/messages', authMiddleware, async (req, res) => {
    const { text, recipient } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing message' });
    const message = { 
        id: Date.now(), 
        sender: req.username, 
        text, 
        recipient: recipient || null, 
        timestamp: new Date().toISOString() 
    };
    messages.push(message);
    await saveData(messagesFile, messages);
    res.json(message);
});

// Admin Endpoints
app.delete('/admin/users/:username', authMiddleware, rootMiddleware, async (req, res) => {
    const usernameToDelete = req.params.username;
    if (usernameToDelete === 'root') return res.status(400).json({ error: 'Cannot delete root account' });
    users = users.filter(u => u.username !== usernameToDelete);
    posts = posts.filter(p => p.username !== usernameToDelete);
    messages = messages.filter(m => m.sender !== usernameToDelete && m.recipient !== usernameToDelete);
    Object.keys(sessions).forEach(sid => {
        if (sessions[sid] === usernameToDelete) delete sessions[sid];
    });
    await saveData(usersFile, users);
    await saveData(postsFile, posts);
    await saveData(messagesFile, messages);
    await saveData(sessionsFile, sessions);
    res.json({ message: `User ${usernameToDelete} deleted` });
});

app.delete('/admin/chats', authMiddleware, rootMiddleware, async (req, res) => {
    messages = [];
    await saveData(messagesFile, messages);
    res.json({ message: 'All chats deleted' });
});

app.delete('/admin/posts/:id', authMiddleware, rootMiddleware, async (req, res) => {
    const postId = parseInt(req.params.id);
    const postIndex = posts.findIndex(p => p.id === postId);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
    posts.splice(postIndex, 1);
    await saveData(postsFile, posts);
    res.json({ message: `Post ${postId} deleted` });
});

app.delete('/admin/storage', authMiddleware, rootMiddleware, async (req, res) => {
    users = users.filter(u => u.username === 'root');
    posts = [];
    messages = [];
    sessions = Object.fromEntries(Object.entries(sessions).filter(([_, username]) => username === 'root'));
    uploadedImages = {};
    await saveData(usersFile, users);
    await saveData(postsFile, posts);
    await saveData(messagesFile, messages);
    await saveData(sessionsFile, sessions);
    res.json({ message: 'All storage cleared except root account' });
});

app.post('/admin/logo', authMiddleware, rootMiddleware, upload.single('logo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const logoId = Date.now().toString();
    uploadedImages[logoId] = req.file.buffer;
    const logoUrl = `/uploads/${logoId}`;
    res.json({ logoUrl });
});

app.get('/admin/users', authMiddleware, rootMiddleware, (req, res) => {
    res.json(users);
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
