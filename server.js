// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Routes
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const voteRoutes = require('./routes/votes');
const communityRoutes = require('./routes/communities');
const notificationRoutes = require('./routes/notifications');
const commentRoutes = require('./routes/comments');
const testRoutes = require('./routes/test');
const searchRoutes = require('./routes/search');

const app = express();

/* ---------------------------------------------------
   BASIC APP CONFIG
--------------------------------------------------- */
app.set('trust proxy', 1);

/* ---------------------------------------------------
   ENV VALIDATION
--------------------------------------------------- */
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is missing');
  process.exit(1);
}

/* ---------------------------------------------------
   CORS CONFIG (FIXED – NO WILDCARDS)
--------------------------------------------------- */
const allowedOrigins = [
  'https://whitepage-one.vercel.app',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, mobile apps)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, origin); // reflect exact origin
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

/* ---------------------------------------------------
   BODY PARSER
--------------------------------------------------- */
app.use(express.json({ limit: '10kb' }));

/* ---------------------------------------------------
   RATE LIMITING
--------------------------------------------------- */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

/* ---------------------------------------------------
   ROUTES
--------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/test', testRoutes);
app.use('/api/search', searchRoutes);

/* ---------------------------------------------------
   HEALTH CHECK
--------------------------------------------------- */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'API is running',
    timestamp: new Date().toISOString(),
  });
});

/* ---------------------------------------------------
   DATABASE CONNECTION
--------------------------------------------------- */
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => {
    console.error('❌ MongoDB Error:', err);
    process.exit(1);
  });

/* ---------------------------------------------------
   ERROR HANDLERS
--------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error(err.message);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS blocked this request' });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

/* ---------------------------------------------------
   SERVER START
--------------------------------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
