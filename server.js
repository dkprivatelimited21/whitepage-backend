// server.js - Production-ready secure Express server
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const Redis = require('ioredis');
const winston = require('winston');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const voteRoutes = require('./routes/votes');
const communityRoutes = require('./routes/communities');
const notificationRoutes = require('./routes/notifications');
const commentRoutes = require('./routes/comments');
const securityRoutes = require('./routes/security'); // New security routes

// Initialize Express app
const app = express();

// ======================
// VALIDATE ENVIRONMENT
// ======================
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'REDIS_URL',
  'NODE_ENV',
  'CORS_ORIGIN',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS'
];

const missingEnvVars = requiredEnvVars.filter(env => !process.env[env]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Validate JWT secret strength
if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long');
  process.exit(1);
}

// ======================
// LOGGING CONFIGURATION
// ======================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// HTTP request logging
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// ======================
// SECURITY MIDDLEWARE
// ======================

// 1. Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.CORS_ORIGIN]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 2. CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN.split(',');
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
    'X-Client-Version',
    'X-Client-Timestamp'
  ],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 3. Rate limiting with Redis store

const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD, // Password added here
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
});

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use IP + user-agent for more accurate rate limiting
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return `${ip}-${userAgent}`;
  },
  skip: (req) => {
    // Skip rate limiting for health checks and certain IPs
    if (req.path === '/health') return true;
    if (process.env.WHITELISTED_IPS) {
      const whitelistedIPs = process.env.WHITELISTED_IPS.split(',');
      const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      return whitelistedIPs.includes(clientIP);
    }
    return false;
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please try again later.',
      retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000)
    });
  }
});

// Apply global rate limiting
app.use(rateLimiter);

// Stricter rate limiting for auth endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    return `auth-${ip}`;
  }
});

// ======================
// BODY PARSING & SECURITY
// ======================

// Body parsing with limits
app.use(express.json({
  limit: '10kb', // Prevent large payload attacks
  verify: (req, res, buf) => {
    // Store raw body for signature verification if needed
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret'));

// 4. Data sanitization against NoSQL injection
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`NoSQL injection attempt detected: ${key}`, {
      ip: req.ip,
      path: req.path
    });
  }
}));

// 5. Data sanitization against XSS
app.use(xss());

// 6. Prevent parameter pollution
app.use(hpp({
  whitelist: [
    'sort',
    'page',
    'limit',
    'fields'
  ]
}));

// 7. CSRF protection (enable for production)
if (process.env.NODE_ENV === 'production') {
  app.use(csrf({ 
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000 // 1 hour
    }
  }));
  
  // Add CSRF token to response
  app.use((req, res, next) => {
    if (req.csrfToken) {
      res.cookie('XSRF-TOKEN', req.csrfToken());
      res.locals.csrfToken = req.csrfToken();
    }
    next();
  });
}

// 8. Compression
app.use(compression());

// ======================
// REQUEST VALIDATION MIDDLEWARE
// ======================

// Request timing and validation
app.use((req, res, next) => {
  // Add request ID for tracing
  req.requestId = require('crypto').randomUUID();
  
  // Log incoming request
  logger.info(`Request ${req.requestId}: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Validate content type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Content-Type must be application/json'
      });
    }
  }
  
  // Set start time for performance measurement
  req.startTime = Date.now();
  
  // Add security headers
  res.set('X-Request-ID', req.requestId);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
});

// ======================
// DATABASE CONNECTION
// ======================

// MongoDB connection with retry logic
const connectWithRetry = (retries = 5, delay = 5000) => {
  mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2,
    retryWrites: true,
    w: 'majority'
  })
  .then(() => {
    logger.info('✅ MongoDB Connected Successfully');
    
    // Monitor MongoDB connection
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
      setTimeout(() => connectWithRetry(), 5000);
    });
  })
  .catch((err) => {
    logger.error(`❌ MongoDB Connection Error (attempt ${6 - retries}/5):`, err.message);
    
    if (retries > 0) {
      logger.info(`Retrying connection in ${delay/1000} seconds...`);
      setTimeout(() => connectWithRetry(retries - 1, delay), delay);
    } else {
      logger.error('Failed to connect to MongoDB after multiple attempts. Exiting...');
      process.exit(1);
    }
  });
};

connectWithRetry();

// ======================
// ROUTES
// ======================

// Health checks (no rate limiting)
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisClient.status === 'ready' ? 'connected' : 'disconnected'
  };
  
  res.json(health);
});

app.get('/health/detailed', async (req, res) => {
  try {
    const [dbPing, redisPing] = await Promise.all([
      mongoose.connection.db.admin().ping(),
      redisClient.ping()
    ]);
    
    res.json({
      status: 'OK',
      database: dbPing.ok === 1 ? 'healthy' : 'unhealthy',
      redis: redisPing === 'PONG' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'SERVICE_UNAVAILABLE',
      error: error.message
    });
  }
});

// Apply auth-specific rate limiting
app.use('/api/auth', authRateLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/security', securityRoutes); // Security monitoring endpoints

// Comments routes (mount under posts)
app.use('/api/posts/:postId/comments', (req, res, next) => {
  // Forward postId to the request
  req.postId = req.params.postId;
  next();
}, commentRoutes);

// ======================
// RESPONSE INTERCEPTOR
// ======================

app.use((req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    // Calculate response time
    const responseTime = Date.now() - req.startTime;
    
    // Add response time header
    res.set('X-Response-Time', `${responseTime}ms`);
    
    // Log slow responses
    if (responseTime > 1000) { // More than 1 second
      logger.warn(`Slow response ${req.requestId}: ${responseTime}ms for ${req.method} ${req.path}`);
    }
    
    // Log successful responses (optional)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.info(`Response ${req.requestId}: ${res.statusCode} ${req.method} ${req.path} - ${responseTime}ms`);
    }
    
    return originalJson.call(this, data);
  };
  
  next();
});

// ======================
// ERROR HANDLING
// ======================

// 404 handler
app.use((req, res, next) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error with context
  logger.error(`Error ${req.requestId}:`, {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    body: req.body,
    params: req.params
  });
  
  // Determine status code
  const statusCode = err.statusCode || err.status || 500;
  
  // Determine error message (don't expose internal errors in production)
  let message = err.message;
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }
  
  // CSRF token error
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'Invalid CSRF token',
      code: 'INVALID_CSRF_TOKEN'
    });
  }
  
  // Response
  res.status(statusCode).json({
    error: message,
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ======================
// GRACEFUL SHUTDOWN
// ======================

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  // Close server first to stop accepting new requests
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close Redis connection
      await redisClient.quit();
      logger.info('Redis connection closed');
      
      // Close MongoDB connection
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Handle signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  
  // Log startup info
  logger.info('Security features enabled:', {
    helmet: true,
    rateLimiting: true,
    csrf: process.env.NODE_ENV === 'production',
    xssProtection: true,
    hpp: true,
    mongoSanitize: true,
    compression: true
  });
});

// Export for testing
module.exports = { app, server };