// routes/auth.js - Updated version WITHOUT email verification
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
   REGISTRATION (WITH BOT PROTECTION)
--------------------------------------------------- */
router.post('/register', registerLimiter, async (req, res) => {
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

/* ---------------------------------------------------
   LOGIN (NO EMAIL VERIFICATION CHECK)
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

    // Check if account is locked
    if (user.isLocked && user.isLocked()) {
      const lockTime = Math.ceil((user.lockUntil - Date.now()) / 60000); // minutes
      return res.status(403).json({ 
        error: `Account is locked. Try again in ${lockTime} minutes.` 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      // Increment failed attempts
      if (user.incrementLoginAttempts) {
        await user.incrementLoginAttempts();
      } else {
        // Fallback if method doesn't exist
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        if (user.loginAttempts >= 5) {
          user.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
        }
        await user.save();
      }
      
      const attemptsLeft = 5 - (user.loginAttempts || 0);
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
    if (user.resetLoginAttempts) {
      await user.resetLoginAttempts();
    } else {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

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
        karma: user.karma || 0
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
   FORGOT PASSWORD & RESET
--------------------------------------------------- */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal that user doesn't exist (security)
      return res.json({ 
        message: 'If an account exists with this email, you will receive a password reset link.' 
      });
    }

    // Generate password reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour
    
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // In a real app, send email here with reset link
    // For now, just return the token (in development)
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    
    res.json({
      message: 'Password reset link generated.',
      resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined,
      resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Failed to process password reset request' 
    });
  }
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Invalid or expired reset token' 
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.loginAttempts = 0; // Reset login attempts
    user.lockUntil = undefined;
    await user.save();

    // Generate new token
    const authToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Password reset successful!',
      token: authToken
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Failed to reset password' 
    });
  }
});

/* ---------------------------------------------------
   GET CURRENT USER
--------------------------------------------------- */
router.get('/me', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        error: 'No token provided' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    res.json({ 
      user 
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ 
      error: 'Failed to get user information' 
    });
  }
});

/* ---------------------------------------------------
   LOGOUT
--------------------------------------------------- */
router.post('/logout', async (req, res) => {
  try {
    // In a token-based system, logout is handled client-side
    // You could implement token blacklisting here if needed
    res.json({
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      error: 'Logout failed' 
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