const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const voteRoutes = require('./routes/votes');
const communityRoutes = require('./routes/communities');
const notificationRoutes = require('./routes/notifications');
const commentRoutes = require('./routes/comments'); // Add this line

const app = express();

// Middleware
app.use(cors({
  origin: [
    'https://whitepage-one.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/posts', commentRoutes); // This handles /api/posts/:postId/comments

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Reddit Clone API is running' });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});