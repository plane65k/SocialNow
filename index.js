const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const app = express();
const port = 3000;

// In-memory stores (replace with database in production)
let users = [];
let posts = [];
let messages = [];
let sessions = {};
let uploadedImages = {};

const saveData = (filename, data) => {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
};

const loadData = (filename) => {
  try {
    const data = fs.readFileSync(filename, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return []; // Return empty array if file doesn't exist
  }
};

// Load data from files on startup
users = loadData('data_users.json');
sessions = loadData('data_sessions.json');
posts = loadData('data_posts.json');
messages = loadData('data_messages.json');

// Ensure root account exists
if (!users.find(u => u.username === 'root')) {
  users.push({ 
    username: 'root', 
    password: 'rootdev', 
    profilePic: 'https://images.squarespace-cdn.com/content/v1/5936fbebcd0f68f67d5916ff/19b38924-e394-467f-9929-ca3a4f9d11bc/person-placeholder-300x300.jpeg' 
  });
  saveData('data_users.json', users);
}

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

app.use(express.json());
app.use(express.static('public'));

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
  saveData('data_users.json', users);
  const sessionId = Date.now().toString();
  sessions[sessionId] = username;
  saveData('data_sessions.json', sessions);
  res.json({ sessionId });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const sessionId = Date.now().toString();
  sessions[sessionId] = username;
  saveData('data_sessions.json', sessions);
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
app.post('/posts', authMiddleware, upload.single('image'), (req, res) => {
  const { caption } = req.body;
  if (!caption || (!req.file && !req.body.imageUrl)) return res.status(400).json({ error: 'Missing fields' });

  let imageUrl;
  if (req.file) {
    imageUrl = `/uploads/${req.file.filename}`;
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
  saveData('data_posts.json', posts);
  res.json(post);
});

// Serve uploaded images
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
  saveData('data_posts.json', posts);
  res.json(post);
});

// Like a post (only once per user)
app.post('/posts/:id/like', authMiddleware, (req, res) => {
  const postId = parseInt(req.params.id);
  const post = posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.likedBy.includes(req.username)) return res.status(400).json({ error: 'You already liked this post' });

  post.likes += 1;
  post.likedBy.push(req.username);
  saveData('data_posts.json', posts);
  res.json(post);
});

// Get all chat messages (filtered for user)
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
  saveData('data_messages.json', messages);
  res.json(message);
});

// Root Admin Endpoints
app.delete('/admin/users/:username', authMiddleware, rootMiddleware, (req, res) => {
  const usernameToDelete = req.params.username;
  if (usernameToDelete === 'root') return res.status(400).json({ error: 'Cannot delete root account' });
  users = users.filter(u => u.username !== usernameToDelete);
  posts = posts.filter(p => p.username !== usernameToDelete);
  messages = messages.filter(m => m.sender !== usernameToDelete && m.recipient !== usernameToDelete);
  Object.keys(sessions).forEach(sid => {
    if (sessions[sid] === usernameToDelete) delete sessions[sid];
  });
  saveData('data_users.json', users);
  saveData('data_posts.json', posts);
  saveData('data_messages.json', messages);
  saveData('data_sessions.json', sessions);
  res.json({ message: `User ${usernameToDelete} deleted` });
});

app.delete('/admin/chats', authMiddleware, rootMiddleware, (req, res) => {
  messages = [];
  saveData('data_messages.json', messages);
  res.json({ message: 'All chats deleted' });
});

app.delete('/admin/posts/:id', authMiddleware, rootMiddleware, (req, res) => {
  const postId = parseInt(req.params.id);
  const postIndex = posts.findIndex(p => p.id === postId);
  if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
  posts.splice(postIndex, 1);
  saveData('data_posts.json', posts);
  res.json({ message: `Post ${postId} deleted` });
});

app.delete('/admin/storage', authMiddleware, rootMiddleware, (req, res) => {
  users = users.filter(u => u.username === 'root');
  posts = [];
  messages = [];
  sessions = Object.fromEntries(Object.entries(sessions).filter(([_, username]) => username === 'root'));
  uploadedImages = {};
  saveData('data_users.json', users);
  saveData('data_posts.json', posts);
  saveData('data_messages.json', messages);
  saveData('data_sessions.json', sessions);
  res.json({ message: 'All storage cleared except root account' });
});

app.post('/admin/logo', authMiddleware, rootMiddleware, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const logoUrl = `/uploads/${req.file.filename}`;
  res.json({ logoUrl });
});

app.get('/admin/users', authMiddleware, rootMiddleware, (req, res) => {
  res.json(users);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});