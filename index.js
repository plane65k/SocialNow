const express = require('express');
const multer = require('multer'); // Added missing import
const app = express();

// Use Render's dynamic port
const port = process.env.PORT || 3000;

// In-memory stores (no persistent filesystem on free Render)
let users = [];
let posts = [];
let messages = [];
let sessions = {};
let uploadedImages = {};

// Ensure root account exists on startup
if (!users.find(u => u.username === 'root')) {
  users.push({ 
    username: 'root', 
    password: 'rootdev', 
    profilePic: 'https://images.squarespace-cdn.com/content/v1/5936fbebcd0f68f67d5916ff/19b38924-e394-467f-9929-ca3a4f9d11bc/person-placeholder-300x300.jpeg' 
  });
}

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
app.post('/register', (req, res) => {
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
  res.json({ sessionId });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const sessionId = Date.now().toString();
  sessions[sessionId] = username;
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

// Create a post with image upload (in-memory)
app.post('/posts', authMiddleware, upload.single('image'), (req, res) => {
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
app.post('/posts/:id/comments', authMiddleware, (req, res) => {
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
  res.json(post);
});

// Like a post
app.post('/posts/:id/like', authMiddleware, (req, res) => {
  const postId = parseInt(req.params.id);
  const post = posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.likedBy.includes(req.username)) return res.status(400).json({ error: 'You already liked this post' });
  post.likes += 1;
  post.likedBy.push(req.username);
  res.json(post);
});

// Get all chat messages
app.get('/messages', authMiddleware, (req, res) => {
  res.json(messages.filter(m => !m.recipient || m.recipient === req.username || m.sender === req.username));
});

// Send a chat message
app.post('/messages', authMiddleware, (req, res) => {
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
  res.json(message);
});

// Admin Endpoints (simplified)
app.delete('/admin/users/:username', authMiddleware, rootMiddleware, (req, res) => {
  const usernameToDelete = req.params.username;
  if (usernameToDelete === 'root') return res.status(400).json({ error: 'Cannot delete root account' });
  users = users.filter(u => u.username !== usernameToDelete);
  posts = posts.filter(p => p.username !== usernameToDelete);
  messages = messages.filter(m => m.sender !== usernameToDelete && m.recipient !== usernameToDelete);
  Object.keys(sessions).forEach(sid => {
    if (sessions[sid] === usernameToDelete) delete sessions[sid];
  });
  res.json({ message: `User ${usernameToDelete} deleted` });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
