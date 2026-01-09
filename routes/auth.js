// routes/auth.js - Complete authentication routes
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

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per IP
  message: 'Too many login attempts from this IP, please try again later.'
});

// Rate limiting for password reset
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 reset attempts per IP
  message: 'Too many password reset attempts, please try again later.'
});

/* ---------------------------------------------------
   REGISTRATION
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

/* ---------------------------------------------------
   LOGIN
--------------------------------------------------- */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      const lockTimeLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ 
        error: `Account is locked. Try again in ${lockTimeLeft} minutes.` 
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      // Increment failed attempts
      await user.incrementLoginAttempts();
      
      // Check if account is now locked
      if (user.isLocked()) {
        return res.status(423).json({ 
          error: 'Too many failed attempts. Account locked for 15 minutes.' 
        });
      }
      
      const attemptsLeft = 5 - user.loginAttempts;
      return res.status(401).json({ 
        error: `Invalid email or password. ${attemptsLeft} attempts remaining.` 
      });
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
      message: 'Login successful!',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma || 0,
        lastLogin: user.lastLogin
      },
      token,
      success: true
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Login failed. Please try again.' 
    });
  }
});

/* ---------------------------------------------------
   LOGOUT (client-side token invalidation)
--------------------------------------------------- */
router.post('/logout', (req, res) => {
  // Note: For JWT, logout is typically handled client-side by removing the token
  // This endpoint can be used for server-side session cleanup if needed
  res.json({
    message: 'Logged out successfully. Please clear your token on the client side.',
    success: true
  });
});

/* ---------------------------------------------------
   FORGOT PASSWORD - Request reset
--------------------------------------------------- */
router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    const user = await User.findOne({ email });
    
    if (!user) {
      // Don't reveal that user doesn't exist for security
      return res.json({ 
        message: 'If an account exists with this email, a reset link will be sent.' 
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

    // Save to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // In a real app, you would send an email here
    // For now, we'll return the token (in production, send via email)
    res.json({
      message: 'Password reset initiated.',
      resetToken: resetToken, // In production, remove this line and send email
      success: true
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Password reset request failed. Please try again.' 
    });
  }
});

/* ---------------------------------------------------
   RESET PASSWORD - Complete reset
--------------------------------------------------- */
router.post('/reset-password/:token', resetLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Find user with valid reset token
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
    await user.save();

    res.json({
      message: 'Password reset successful! You can now login with your new password.',
      success: true
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Password reset failed. Please try again.' 
    });
  }
});

/* ---------------------------------------------------
   VERIFY TOKEN/ME - Get current user info
--------------------------------------------------- */
router.get('/me', async (req, res) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'No token provided' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.userId).select('-password -resetPasswordToken -resetPasswordExpires');
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma || 0,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      success: true
    });

  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired' 
      });
    }
    
    res.status(500).json({ 
      error: 'Authentication failed' 
    });
  }
});

/* ---------------------------------------------------
   UPDATE PROFILE
--------------------------------------------------- */
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    const { username, email, currentPassword, newPassword } = req.body;

    // Update username if provided and different
    if (username && username !== user.username) {
      // Check if username is taken
      const existingUser = await User.findOne({ username });
      if (existingUser && existingUser._id.toString() !== user._id.toString()) {
        return res.status(400).json({ 
          error: 'Username already taken' 
        });
      }
      
      // Check for suspicious usernames
      if (await isSuspiciousUsername(username)) {
        return res.status(400).json({ 
          error: 'Username not allowed' 
        });
      }
      
      user.username = username;
    }

    // Update email if provided and different
    if (email && email !== user.email) {
      // Check if email is taken
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== user._id.toString()) {
        return res.status(400).json({ 
          error: 'Email already in use' 
        });
      }
      
      // Check for disposable email
      if (await checkDisposableEmail(email)) {
        return res.status(400).json({ 
          error: 'Disposable email addresses are not allowed' 
        });
      }
      
      user.email = email;
    }

    // Update password if requested
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ 
          error: 'Current password is required to set a new password' 
        });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({ 
          error: 'Current password is incorrect' 
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ 
          error: 'New password must be at least 6 characters' 
        });
      }

      user.password = newPassword;
    }

    await user.save();

    // Generate new token if credentials changed
    const newToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma || 0
      },
      token: newToken,
      success: true
    });

  } catch (error) {
    console.error('Profile update error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token' 
      });
    }
    
    res.status(500).json({ 
      error: 'Profile update failed' 
    });
  }
});

/* ---------------------------------------------------
   SECURITY HELPER FUNCTIONS
--------------------------------------------------- */

// Check for disposable emails
async function checkDisposableEmail(email) {
  try {
    const domain = email.split('@')[1];
    const disposableDomains = [
      'tempmail.com', 'mailinator.com', 'guerrillamail.com',
      '10minutemail.com', 'throwawaymail.com', 'yopmail.com',
      'temp-mail.org', 'fakeinbox.com', 'trashmail.com',
      'dispostable.com', 'getairmail.com', 'maildrop.cc',
      'tempail.com', 'sharklasers.com', 'grr.la'
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
    /^[a-f0-9]{32}$/, // MD5 hash-like
    /^[a-f0-9]{40}$/, // SHA-1 hash-like
    /^[a-f0-9]{64}$/ // SHA-256 hash-like
  ];

  return suspiciousPatterns.some(pattern => pattern.test(username));
}

module.exports = router;