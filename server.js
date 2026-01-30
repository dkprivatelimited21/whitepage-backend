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
   CORS CONFIG (COMPREHENSIVE FIX)
--------------------------------------------------- */
const allowedOrigins = [
  'https://whitepage-one.vercel.app',
  'http://localhost:3000',
  'capacitor://localhost'
];

// Debug middleware to log CORS requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  next();
});

// Handle preflight OPTIONS requests
app.options('*', cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400
}));

// Main CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, origin);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  maxAge: 86400,
  optionsSuccessStatus: 200
}));

// Manual CORS headers as backup
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  }
  
  next();
});

/* ---------------------------------------------------
   BODY PARSER
--------------------------------------------------- */
app.use(express.json({ limit: '10kb' }));

/* ---------------------------------------------------
   RATE LIMITING
--------------------------------------------------- */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased for testing
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for OPTIONS requests (preflight)
    return req.method === 'OPTIONS';
  }
});

app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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
  console.error('Error:', err.message);
  
  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS blocked this request',
      allowedOrigins,
      yourOrigin: req.headers.origin 
    });
  }
  
  // Rate limit errors
  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      error: 'Too many requests, please try again later.'
    });
  }
  
  // General errors
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
  console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
});