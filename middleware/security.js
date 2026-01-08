// middleware/security.js
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Check for bot-like behavior
const checkBot = (req, res, next) => {
  const userAgent = req.get('User-Agent') || '';
  
  // Common bot user agents
  const botPatterns = [
    /bot/i,
    /crawl/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /python/i,
    /java/i,
    /php/i,
    /node/i
  ];
  
  const isLikelyBot = botPatterns.some(pattern => 
    pattern.test(userAgent)
  );
  
  // Check for missing or suspicious headers
  const missingCommonHeaders = !req.get('Accept') || !req.get('Accept-Language');
  
  // Check for too fast submissions
  const submissionTime = Date.now();
  const lastRequestTime = req.session?.lastRequestTime || 0;
  const tooFast = submissionTime - lastRequestTime < 2000; // Less than 2 seconds
  
  if ((isLikelyBot && missingCommonHeaders) || tooFast) {
    return res.status(403).json({
      error: 'Suspicious activity detected. Please try again.'
    });
  }
  
  // Store request time for next check
  if (!req.session) req.session = {};
  req.session.lastRequestTime = submissionTime;
  
  next();
};

// Honeypot field check
const checkHoneypot = (req, res, next) => {
  // Add a hidden field named "website" or "url" in your form
  // Bots often fill this field
  if (req.body.website || req.body.url) {
    return res.status(400).json({
      error: 'Spam detected'
    });
  }
  
  // Check for rapid form submission
  const now = Date.now();
  const lastSubmission = req.session?.lastFormSubmission || 0;
  
  if (now - lastSubmission < 3000) { // 3 seconds minimum between submissions
    return res.status(429).json({
      error: 'Please wait a moment before trying again.'
    });
  }
  
  req.session.lastFormSubmission = now;
  next();
};

// IP-based rate limiting (more strict)
const strictRegisterLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 registrations per day per IP
  message: 'Too many registration attempts from this IP address.',
  skipSuccessfulRequests: true
});

module.exports = {
  checkBot,
  checkHoneypot,
  strictRegisterLimiter
};