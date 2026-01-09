// routes/auth.js - Updated version without reCAPTCHA
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Rate limiting for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: 'Too many registration attempts from this IP, please try again later.'
});

/* ---------------------------------------------------
   REGISTRATION (WITHOUT reCAPTCHA, but still has rate limiting)
--------------------------------------------------- */
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ 
        error: 'All fields are required' 
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
      if (existingUser.email === email) {
        return res.status(400).json({ 
          error: 'Email already registered. Try logging in or use a different email.' 
        });
      }
      if (existingUser.username === username) {
        return res.status(400).json({ 
          error: 'Username already taken. Please choose another.' 
        });
      }
    }

    // Check for disposable email
    const isDisposableEmail = await checkDisposableEmail(email);
    if (isDisposableEmail) {
      return res.status(400).json({ 
        error: 'Disposable email addresses are not allowed' 
      });
    }

    // Additional username checks
    if (await isSuspiciousUsername(username)) {
      return res.status(400).json({ 
        error: 'Username not allowed. Please choose a different username.' 
      });
    }

    // Create user (immediately active, no email verification needed)
    const user = new User({ 
      username, 
      email, 
      password
    });

    await user.save();

    // Generate token immediately
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful! Welcome to our community.',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma || 0
      },
      token,
      success: true
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Registration failed. Please try again.' 
    });
  }
});

// ... keep the rest of the auth.js file the same (login, forgot password, etc.) ...

/* ---------------------------------------------------
   SECURITY HELPER FUNCTIONS (keep these but remove verifyRecaptcha)
--------------------------------------------------- */

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

// Check for suspicious usernames
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

module.exports = router;