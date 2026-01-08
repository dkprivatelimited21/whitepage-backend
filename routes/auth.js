// routes/auth.js - Updated version without email verification
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Additional security middleware
const securityMiddleware = require('../middleware/security');

// Rate limiting for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: 'Too many registration attempts from this IP, please try again later.'
});

/* ---------------------------------------------------
   REGISTRATION (WITH BOT PROTECTION)
--------------------------------------------------- */
router.post('/register', registerLimiter, securityMiddleware.checkBot, async (req, res) => {
  try {
    const { username, email, password, recaptchaToken } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ 
        error: 'All fields are required' 
      });
    }

    // Validate reCAPTCHA
    if (!recaptchaToken) {
      return res.status(400).json({ 
        error: 'reCAPTCHA verification required' 
      });
    }

    // Verify reCAPTCHA with Google
    const recaptchaVerified = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaVerified) {
      return res.status(400).json({ 
        error: 'reCAPTCHA verification failed' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'Username or email already exists' 
      });
    }

    // Check for disposable email
    const isDisposableEmail = await checkDisposableEmail(email);
    if (isDisposableEmail) {
      return res.status(400).json({ 
        error: 'Disposable email addresses are not allowed' 
      });
    }

    // Additional checks
    if (await isSuspiciousUsername(username)) {
      return res.status(400).json({ 
        error: 'Username not allowed. Please choose a different username.' 
      });
    }

    // Create user (auto-verified)
    const user = new User({ 
      username, 
      email, 
      password,
      emailVerified: true, // Auto-verify since no email verification
      createdAt: new Date()
    });

    await user.save();

    // Optional: Send welcome email (not verification)
    sendWelcomeEmail(email, username);

    res.status(201).json({
      message: 'Registration successful! Welcome to our community.',
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      },
      success: true
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Registration failed. Please try again.' 
    });
  }
});

/* ---------------------------------------------------
   LOGIN (SIMPLIFIED - NO EMAIL VERIFICATION CHECK)
--------------------------------------------------- */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username/email and password are required' 
      });
    }

    const user = await User.findOne({ 
      $or: [{ email: username }, { username }] 
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      // Increment failed attempts (security against brute force)
      await user.incrementLoginAttempts();
      
      const attemptsLeft = 5 - user.loginAttempts;
      if (attemptsLeft > 0) {
        return res.status(401).json({ 
          error: `Invalid credentials. ${attemptsLeft} attempts remaining.` 
        });
      } else {
        return res.status(403).json({ 
          error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' 
        });
      }
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Login failed. Please try again.' 
    });
  }
});

/* ---------------------------------------------------
   SECURITY HELPER FUNCTIONS
--------------------------------------------------- */

// reCAPTCHA verification
async function verifyRecaptcha(token) {
  try {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
      console.warn('reCAPTCHA secret key not configured');
      return true; // Skip in development
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });

    const data = await response.json();
    return data.success && data.score >= 0.5; // Require score > 0.5 (likely human)
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    return false;
  }
}

// Check for disposable emails
async function checkDisposableEmail(email) {
  try {
    const domain = email.split('@')[1];
    const disposableDomains = [
      'tempmail.com', 'mailinator.com', 'guerrillamail.com',
      '10minutemail.com', 'throwawaymail.com', 'yopmail.com',
      'temp-mail.org', 'fakeinbox.com', 'trashmail.com'
    ];
    
    return disposableDomains.includes(domain.toLowerCase());
  } catch (error) {
    return false;
  }
}

// Check for suspicious usernames (bots often use patterns)
async function isSuspiciousUsername(username) {
  const suspiciousPatterns = [
    /^[0-9]{8,}$/, // All numbers
    /^[a-z]{1}[0-9]{5,}$/, // Letter followed by numbers
    /^(user|admin|mod|test)\d+$/i, // Common bot names
    /.*(bot|crawl|spider|scraper).*/i, // Contains bot-related words
    /^[a-f0-9]{32}$/ // MD5 hash-like
  ];

  return suspiciousPatterns.some(pattern => pattern.test(username));
}

// Send welcome email (optional)
async function sendWelcomeEmail(email, username) {
  if (process.env.SEND_WELCOME_EMAIL === 'true') {
    const welcomeHtml = `
      <h1>Welcome to Our Community, ${username}!</h1>
      <p>Thank you for joining us. Your account has been created successfully.</p>
      <p>Start exploring and be part of our growing community!</p>
    `;
    
    // Use your email sending logic here
  }
}

module.exports = router;