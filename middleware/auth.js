// auth.js - Production-ready secure authentication middleware
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');

// Initialize Redis client for token blacklisting and rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

// Token blacklist
const TokenBlacklist = require('../models/TokenBlacklist');

// Rate limiter for authentication attempts
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  keyGenerator: (req) => {
    // Use IP + user-agent for rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    return crypto.createHash('sha256').update(ip + userAgent).digest('hex');
  },
  handler: (req, res) => {
    res.status(429).json({ 
      error: 'Too many authentication requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Enhanced authentication middleware
const auth = async (req, res, next) => {
  try {
    // Apply rate limiting
    await new Promise((resolve, reject) => {
      authRateLimiter(req, res, (err) => {
        if (err) reject(err);
        resolve();
      });
    });

    // Extract token from multiple sources
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    // Check token length and format
    if (token.length < 50 || token.length > 500) {
      return res.status(401).json({ 
        error: 'Invalid token format',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }

    // Check if token is blacklisted (in-memory cache first)
    const blacklistCacheKey = `blacklist:${crypto.createHash('sha256').update(token).digest('hex')}`;
    const cachedBlacklist = await redis.get(blacklistCacheKey);
    
    if (cachedBlacklist === 'true') {
      await logSecurityEvent(req, 'BLACKLISTED_TOKEN_ACCESS', { token: token.substring(0, 20) + '...' });
      return res.status(401).json({ 
        error: 'Session expired. Please login again.',
        code: 'TOKEN_BLACKLISTED'
      });
    }

    // Check database blacklist for extra security
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const isBlacklisted = await TokenBlacklist.findOne({ 
      tokenHash,
      expiresAt: { $gt: new Date() }
    });

    if (isBlacklisted) {
      // Cache in Redis for faster future checks
      await redis.setex(blacklistCacheKey, 3600, 'true'); // Cache for 1 hour
      await logSecurityEvent(req, 'BLACKLISTED_TOKEN_ACCESS', { tokenHash });
      return res.status(401).json({ 
        error: 'Session expired. Please login again.',
        code: 'TOKEN_BLACKLISTED'
      });
    }

    // Verify JWT with enhanced options
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      ignoreExpiration: false,
      clockTolerance: 30, // 30 seconds tolerance
      maxAge: process.env.TOKEN_MAX_AGE || '24h'
    });

    // Validate token structure
    if (!decoded.userId || !decoded.iss || !decoded.aud) {
      await logSecurityEvent(req, 'MALFORMED_TOKEN', { decoded });
      return res.status(401).json({ 
        error: 'Invalid token structure',
        code: 'INVALID_TOKEN_STRUCTURE'
      });
    }

    // Verify issuer and audience
    if (decoded.iss !== process.env.JWT_ISSUER || decoded.aud !== process.env.JWT_AUDIENCE) {
      await logSecurityEvent(req, 'INVALID_TOKEN_ISSUER_AUDIENCE', { 
        issuer: decoded.iss, 
        audience: decoded.aud 
      });
      return res.status(401).json({ 
        error: 'Invalid token source',
        code: 'INVALID_TOKEN_SOURCE'
      });
    }

    // Check token version (for future invalidation)
    if (decoded.version !== process.env.TOKEN_VERSION) {
      await logSecurityEvent(req, 'OUTDATED_TOKEN_VERSION', { 
        tokenVersion: decoded.version,
        expectedVersion: process.env.TOKEN_VERSION
      });
      return res.status(401).json({ 
        error: 'Session outdated. Please login again.',
        code: 'TOKEN_VERSION_MISMATCH'
      });
    }

    // Check for suspicious IP changes (if lastLoginIp exists)
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').substring(0, 16);

    // Find user with additional security checks
    const user = await User.findById(decoded.userId)
      .select('+lastLoginIp +lastLoginAt +loginHistory +twoFactorEnabled +accountLocked +lockUntil +failedLoginAttempts')
      .lean();

    if (!user) {
      await logSecurityEvent(req, 'USER_NOT_FOUND', { userId: decoded.userId });
      return res.status(401).json({ 
        error: 'Account not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if account is locked
    if (user.accountLocked && user.lockUntil && user.lockUntil > new Date()) {
      await logSecurityEvent(req, 'LOCKED_ACCOUNT_ACCESS', { userId: decoded.userId });
      return res.status(403).json({ 
        error: 'Account temporarily locked. Please try again later.',
        code: 'ACCOUNT_LOCKED',
        lockUntil: user.lockUntil
      });
    }

    // Check for suspicious IP changes (optional, can be enabled for high security)
    if (process.env.ENABLE_IP_VALIDATION === 'true' && user.lastLoginIp) {
      const lastIpHash = crypto.createHash('sha256').update(user.lastLoginIp).digest('hex').substring(0, 16);
      
      if (ipHash !== lastIpHash && !isLocalNetwork(clientIp)) {
        // Log suspicious activity but allow if not too frequent
        await logSecurityEvent(req, 'SUSPICIOUS_IP_CHANGE', {
          userId: decoded.userId,
          previousIp: user.lastLoginIp,
          currentIp: clientIp
        });

        // Send security alert email (optional)
        if (process.env.ENABLE_SECURITY_ALERTS === 'true') {
          await sendSecurityAlert(user.email, {
            type: 'suspicious_ip',
            ip: clientIp,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Check if user is required to change password
    if (user.forcePasswordChange && user.passwordChangedAt) {
      const passwordAge = Date.now() - new Date(user.passwordChangedAt).getTime();
      const maxPasswordAge = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
      
      if (passwordAge > maxPasswordAge) {
        return res.status(403).json({
          error: 'Password expired. Please change your password.',
          code: 'PASSWORD_EXPIRED',
          requiresPasswordChange: true
        });
      }
    }

    // Check for concurrent sessions (optional)
    if (process.env.MAX_CONCURRENT_SESSIONS > 0) {
      const sessionKey = `user:${user._id}:sessions`;
      const sessionCount = await redis.scard(sessionKey);
      
      if (sessionCount >= process.env.MAX_CONCURRENT_SESSIONS) {
        // Check if this token is in the valid sessions set
        const isValidSession = await redis.sismember(sessionKey, tokenHash);
        
        if (!isValidSession) {
          await logSecurityEvent(req, 'MAX_CONCURRENT_SESSIONS', { userId: user._id });
          return res.status(403).json({
            error: 'Too many active sessions. Please logout from other devices.',
            code: 'MAX_SESSIONS_EXCEEDED'
          });
        }
      }
    }

    // Add security headers to response
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    // Attach user and token to request
    req.user = user;
    req.token = token;
    req.tokenHash = tokenHash;
    req.clientIp = clientIp;
    req.userAgent = req.headers['user-agent'] || '';

    // Log successful authentication
    await logSecurityEvent(req, 'AUTH_SUCCESS', {
      userId: user._id,
      method: req.method,
      endpoint: req.originalUrl
    });

    next();
  } catch (error) {
    // Handle different JWT errors specifically
    if (error.name === 'TokenExpiredError') {
      await logSecurityEvent(req, 'TOKEN_EXPIRED', { error: error.message });
      return res.status(401).json({ 
        error: 'Session expired. Please login again.',
        code: 'TOKEN_EXPIRED',
        requiresRefresh: true
      });
    }

    if (error.name === 'JsonWebTokenError') {
      await logSecurityEvent(req, 'JWT_ERROR', { error: error.message });
      return res.status(401).json({ 
        error: 'Invalid authentication token',
        code: 'INVALID_TOKEN'
      });
    }

    if (error.name === 'RateLimitError') {
      return res.status(429).json({ 
        error: 'Too many authentication requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: error.retryAfter
      });
    }

    // Log unexpected errors
    await logSecurityEvent(req, 'AUTH_UNEXPECTED_ERROR', {
      error: error.message,
      stack: error.stack
    });

    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'Authentication failed' 
      : error.message;

    res.status(500).json({ 
      error: errorMessage,
      code: 'AUTH_ERROR'
    });
  }
};

// Helper function to extract token from multiple sources
function extractToken(req) {
  // Check Authorization header first
  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookies (for CSRF protection)
  if (req.cookies && req.cookies.access_token) {
    return req.cookies.access_token;
  }

  // Check query parameter (for WebSocket connections, less secure)
  if (req.query && req.query.token) {
    return req.query.token;
  }

  return null;
}

// Security event logging
async function logSecurityEvent(req, eventType, metadata = {}) {
  const event = {
    type: eventType,
    timestamp: new Date(),
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || '',
    endpoint: req.originalUrl,
    method: req.method,
    metadata
  };

  try {
    // Log to database
    const SecurityLog = require('../models/SecurityLog');
    await SecurityLog.create(event);

    // Also log to Redis for real-time monitoring
    await redis.lpush('security:events', JSON.stringify(event));
    await redis.ltrim('security:events', 0, 999); // Keep last 1000 events
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

// Check if IP is from local network
function isLocalNetwork(ip) {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  
  // Check private IP ranges
  const parts = ip.split('.');
  if (parts.length === 4) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
  }
  
  return false;
}

// Send security alert (stub - implement with your email service)
async function sendSecurityAlert(email, alertData) {
  // Implement with nodemailer, SendGrid, etc.
  console.log(`Security alert for ${email}:`, alertData);
}

// Optional: Middleware to require specific user roles
auth.requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

// Optional: Middleware to require 2FA for sensitive operations
auth.require2FA = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.twoFactorEnabled && !req.headers['x-2fa-verified']) {
    return res.status(403).json({
      error: 'Two-factor authentication required',
      code: '2FA_REQUIRED',
      requires2FA: true
    });
  }

  next();
};

// Optional: Token refresh middleware
auth.refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    // Verify refresh token (similar to auth middleware but with different secret)
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Check if refresh token is valid and not blacklisted
    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: decoded.userId,
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        version: process.env.TOKEN_VERSION
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.TOKEN_EXPIRY || '1h' }
    );

    req.newToken = newToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

module.exports = auth;