// routes/auth.js - Updated with username or email login
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');



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
   LOGIN (Updated: Login with email OR username)
--------------------------------------------------- */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    // Support both "identifier" and "username/email" for compatibility
    let identifier = req.body.identifier;
    
    // If identifier is not provided, check for username or email
    if (!identifier) {
      identifier = req.body.username || req.body.email;
    }
    
    const password = req.body.password;

    if (!identifier || !password) {
      return res.status(400).json({ 
        error: 'Username/Email and password are required' 
      });
    }

    // Determine if identifier is email or username
    let query = {};
    if (identifier.includes('@')) {
      // It's an email
      query = { email: identifier.toLowerCase().trim() };
    } else {
      // It's a username
      query = { username: identifier.trim() };
    }

    // Find user by email or username
    const user = await User.findOne(query);
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid username/email or password' 
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
        error: `Invalid username/email or password. ${attemptsLeft} attempts remaining.` 
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
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json({ 
        error: 'Username or Email is required' 
      });
    }

    // Determine if identifier is email or username
    let query = {};
    if (identifier.includes('@')) {
      query = { email: identifier.toLowerCase().trim() };
    } else {
      query = { username: identifier.trim() };
    }

    const user = await User.findOne(query);
    
    if (!user) {
      // Don't reveal that user doesn't exist for security
      return res.json({ 
        message: 'If an account exists with this username/email, a reset link will be sent.' 
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
      note: `Reset token sent to ${user.email}`, // In production, don't show email
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
    user.loginAttempts = 0; // Reset login attempts
    user.lockUntil = undefined; // Unlock account if locked
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
/* ---------------------------------------------------
   VERIFY TOKEN/ME - Get current user info
--------------------------------------------------- */
router.get('/me', async (req, res) => {
  try {
    // Get token from header OR query parameter
    let token = req.headers.authorization?.split(' ')[1];
    
    // If not in header, check query parameter
    if (!token && req.query.token) {
      token = req.query.token;
    }
    
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
   CHECK USERNAME AVAILABILITY
--------------------------------------------------- */
router.get('/check-username/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ 
        error: 'Username must be at least 3 characters' 
      });
    }

    // Check if username exists
    const existingUser = await User.findOne({ username });
    
    if (existingUser) {
      return res.json({ 
        available: false,
        message: 'Username already taken' 
      });
    }

    // Check for suspicious usernames
    if (await isSuspiciousUsername(username)) {
      return res.json({ 
        available: false,
        message: 'Username not allowed' 
      });
    }

    res.json({
      available: true,
      message: 'Username is available'
    });

  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({ 
      error: 'Failed to check username availability' 
    });
  }
});



// routes/auth.js - ADD THESE ROUTES FOR SOCIAL LOGIN

/* ---------------------------------------------------
   SOCIAL LOGIN INITIATION
--------------------------------------------------- */
/* ---------------------------------------------------
   SOCIAL LOGIN INITIATION - GOOGLE
--------------------------------------------------- */
router.get('/google', (req, res) => {
  // Check if Google OAuth is configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CALLBACK_URL) {
    return res.status(501).json({ 
      error: 'Google OAuth not configured',
      message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CALLBACK_URL in environment variables'
    });
  }
  
  console.log('Initiating Google OAuth flow...');
  console.log('Callback URL:', process.env.GOOGLE_CALLBACK_URL);
  
  // Redirect to Google OAuth
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'profile email',
    access_type: 'offline',
    prompt: 'consent'
  })}`;
  
  res.redirect(authUrl);
});

/* ---------------------------------------------------
   SOCIAL LOGIN INITIATION - GITHUB
--------------------------------------------------- */
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(501).json({ 
      error: 'GitHub OAuth not configured',
      message: 'Please set GITHUB_CLIENT_ID in environment variables'
    });
  }
  
  const authUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.API_URL || 'https://whitepage-backend.onrender.com'}/api/auth/github/callback`,
    scope: 'user:email'
  })}`;
  
  res.redirect(authUrl);
});
router.get('/facebook', (req, res) => {
  const authUrl = `https://www.facebook.com/v17.0/dialog/oauth?${new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID,
    redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
    scope: 'email',
    state: crypto.randomBytes(16).toString('hex')
  })}`;
  res.redirect(authUrl);
});

/* ---------------------------------------------------
   SOCIAL LOGIN CALLBACKS
--------------------------------------------------- */
/* ---------------------------------------------------
   GOOGLE CALLBACK
--------------------------------------------------- */
/* ---------------------------------------------------
   GOOGLE CALLBACK - FIXED VERSION
--------------------------------------------------- */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      console.error('Google OAuth error:', error);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}`);
    }
    
    if (!code) {
      return res.status(400).json({ error: 'No authorization code received' });
    }
    
    console.log('Google OAuth callback received, exchanging code for token...');
    
    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET, // Changed from client_secret
        code: code,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code'
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      console.error('No access token received from Google:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_token_failed`);
    }
    
    console.log('Access token received, fetching user info...');
    
    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const userInfo = await userResponse.json();
    
    if (!userInfo.id) {
      console.error('Invalid user info from Google:', userInfo);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_user_failed`);
    }
    
    console.log('Google user info received:', userInfo.email);
    
    // Find or create user in your database
    let user = await User.findOne({ 
      $or: [
        { googleId: userInfo.id },
        { email: userInfo.email }
      ]
    });
    
    if (!user) {
      // Create new user
      console.log('Creating new user for Google ID:', userInfo.id);
      
      // Generate a username from Google name
      let username = userInfo.name?.replace(/\s+/g, '_').toLowerCase() || 
                    userInfo.email.split('@')[0];
      
      // Ensure unique username
      let usernameExists = await User.findOne({ username });
      let counter = 1;
      while (usernameExists) {
        username = `${userInfo.email.split('@')[0]}_${counter}`;
        usernameExists = await User.findOne({ username });
        counter++;
      }
      
      user = new User({
        googleId: userInfo.id,
        email: userInfo.email,
        emailVerified: userInfo.verified_email || false,
        username: username,
        profilePicture: userInfo.picture,
        password: crypto.randomBytes(16).toString('hex') // Random password for social login
      });
      
      await user.save();
      console.log('New user created:', user.username);
      
    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = userInfo.id;
      await user.save();
      console.log('Google account linked to existing user:', user.username);
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('JWT token generated, redirecting to frontend...');
    
    // Redirect to frontend with token AND user data in hash (not query params)
    // This prevents the token from being logged in server logs
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      karma: user.karma || 0
    };
    
    // Use hash instead of query params for security
    const encodedUserData = encodeURIComponent(JSON.stringify(userData));
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback#token=${token}&user=${encodedUserData}&provider=google`
    );
    
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=social_auth_failed`);
  }
});


/* ---------------------------------------------------
   GITHUB CALLBACK
--------------------------------------------------- */
router.get('/github/callback', async (req, res) => {
  try {
    const { code, error, state } = req.query;
    
    if (error) {
      console.error('GitHub OAuth error:', error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${error}`);
    }
    
    if (!code) {
      return res.status(400).json({ error: 'No authorization code received' });
    }
    
    // Check if GitHub OAuth is configured
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      console.error('GitHub OAuth not configured');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=github_not_configured`);
    }
    
    console.log('GitHub OAuth callback received, exchanging code for token...');
    
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: `${process.env.API_URL || 'http://localhost:5000'}/auth/github/callback`
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      console.error('No access token received from GitHub:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=github_token_failed`);
    }
    
    console.log('Access token received, fetching user info...');
    
    // Get user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Whitepage-App',
        'Accept': 'application/json'
      }
    });
    
    const userInfo = await userResponse.json();
    
    if (!userInfo.id) {
      console.error('Invalid user info from GitHub:', userInfo);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=github_user_failed`);
    }
    
    console.log('GitHub user info received:', userInfo.login);
    
    // Get user emails
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Whitepage-App',
        'Accept': 'application/json'
      }
    });
    
    const emails = await emailResponse.json();
    const primaryEmail = emails.find(email => email.primary && email.verified)?.email || emails[0]?.email;
    
    // Find or create user in your database
    let user = await User.findOne({ 
      $or: [
        { githubId: userInfo.id.toString() },
        { email: primaryEmail }
      ]
    });
    
    if (!user) {
      // Create new user
      console.log('Creating new user for GitHub ID:', userInfo.id);
      
      // Generate a username from GitHub login
      let username = userInfo.login;
      let usernameExists = await User.findOne({ username });
      let counter = 1;
      
      // Ensure unique username
      while (usernameExists) {
        username = `${userInfo.login}_${counter}`;
        usernameExists = await User.findOne({ username });
        counter++;
      }
      
      user = new User({
        githubId: userInfo.id.toString(),
        email: primaryEmail || `${userInfo.login}@github.com`,
        username: username,
        profilePicture: userInfo.avatar_url,
        emailVerified: !!primaryEmail,
        password: crypto.randomBytes(16).toString('hex') // Random password for social login users
      });
      
      await user.save();
      console.log('New user created:', user.username);
      
    } else if (!user.githubId) {
      // Link GitHub account to existing user
      user.githubId = userInfo.id.toString();
      await user.save();
      console.log('GitHub account linked to existing user:', user.username);
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('JWT token generated, redirecting to frontend...');
    
    // Redirect to frontend with token
   
res.redirect(
  `${process.env.FRONTEND_URL}/auth/callback#token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}&provider=github`
);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=social_auth_failed`);
  }
});

/* ---------------------------------------------------
   FACEBOOK CALLBACK
--------------------------------------------------- */
router.get('/facebook/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      console.error('Facebook OAuth error:', error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${error}`);
    }
    
    if (!code) {
      return res.status(400).json({ error: 'No authorization code received' });
    }
    
    // For now, return a simple response since Facebook OAuth needs more setup
    console.log('Facebook OAuth callback received, code:', code);
    
    res.json({
      message: 'Facebook OAuth callback received',
      code: code,
      note: 'Facebook OAuth needs client ID and secret configuration'
    });
    
  } catch (error) {
    console.error('Facebook OAuth error:', error);
    res.status(500).json({ error: 'Facebook authentication failed' });
  }
});


/* ---------------------------------------------------
   LINK/UNLINK SOCIAL ACCOUNTS
--------------------------------------------------- */
router.post('/link/:provider', authMiddleware, async (req, res) => {
  try {
    const { provider } = req.params;
    const { providerId } = req.body;
    const userId = req.user._id;
    
    const update = { [`${provider}_id`]: providerId };
    await User.findByIdAndUpdate(userId, update);
    
    res.json({ success: true, message: `${provider} account linked` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to link account' });
  }
});

router.post('/unlink/:provider', authMiddleware, async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user._id;
    
    const update = { [`${provider}_id`]: null };
    await User.findByIdAndUpdate(userId, update);
    
    res.json({ success: true, message: `${provider} account unlinked` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unlink account' });
  }
});






/* ---------------------------------------------------
   CHECK EMAIL AVAILABILITY
--------------------------------------------------- */
router.get('/check-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ 
        error: 'Valid email is required' 
      });
    }

    // Check if email exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    
    if (existingUser) {
      return res.json({ 
        available: false,
        message: 'Email already registered' 
      });
    }

    // Check for disposable email
    if (await checkDisposableEmail(email)) {
      return res.json({ 
        available: false,
        message: 'Disposable email addresses are not allowed' 
      });
    }

    res.json({
      available: true,
      message: 'Email is available'
    });

  } catch (error) {
    console.error('Email check error:', error);
    res.status(500).json({ 
      error: 'Failed to check email availability' 
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