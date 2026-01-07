const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const voteRoutes = require('./routes/votes');
const communityRoutes = require('./routes/communities');
const notificationRoutes = require('./routes/notifications');
const commentRoutes = require('./routes/comments');

const app = express();

// Validate environment variables
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables');
  process.exit(1);
}

// Middleware
app.use(cors({
  origin: [
    'https://whitepage-one.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/posts', commentRoutes); // Ensure commentRoutes handles subpaths like /:postId/comments

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Reddit Clone API is running' });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB Error:', err);
    process.exit(1);
  });

// Global error handler (should be after all routes)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});