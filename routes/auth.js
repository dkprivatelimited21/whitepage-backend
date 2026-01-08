// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Email configuration
const createTransporter = () => {
  const mailService = process.env.MAIL_SERVICE || 'gmail';
  
  if (mailService === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
  } else if (mailService === 'sendgrid') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });
  } else if (mailService === 'smtp') {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  } else {
    // Fallback to console logging for development
    console.warn('No email service configured. Using console fallback.');
    return null;
  }
};

// Email templates
const emailTemplates = {
  verificationEmail: (username, verificationLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background-color: #ff4500; 
          color: white; 
          text-decoration: none; 
          border-radius: 4px; 
          font-weight: bold; 
          margin: 20px 0; 
          border: none;
          cursor: pointer;
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
          text-align: center;
        }
        .link { 
          word-break: break-all; 
          color: #0066cc; 
          text-decoration: none;
        }
        .link:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Reddit Clone</h1>
        </div>
        <div class="content">
          <h2>Welcome, ${username}!</h2>
          <p>Thank you for registering with Reddit Clone. To complete your registration and activate your account, please verify your email address by clicking the button below:</p>
          
          <div style="text-align: center;">
            <a href="${verificationLink}" class="button">Verify Email Address</a>
          </div>
          
          <p>If the button above doesn't work, you can also copy and paste the following link into your browser:</p>
          <p><a href="${verificationLink}" class="link">${verificationLink}</a></p>
          
          <p><strong>This verification link will expire in 24 hours.</strong></p>
          
          <p><strong>Didn't create an account?</strong><br>
          If you didn't register for Reddit Clone, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>This email was sent by Reddit Clone. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} Reddit Clone. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,

  passwordResetEmail: (username, resetLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background-color: #ff4500; 
          color: white; 
          text-decoration: none; 
          border-radius: 4px; 
          font-weight: bold; 
          margin: 20px 0; 
          border: none;
          cursor: pointer;
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
          text-align: center;
        }
        .warning { 
          background-color: #fff3cd; 
          border: 1px solid #ffeaa7; 
          padding: 15px; 
          border-radius: 4px; 
          margin: 20px 0; 
          color: #856404;
        }
        .link { 
          word-break: break-all; 
          color: #0066cc; 
          text-decoration: none;
        }
        .link:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Reddit Clone</h1>
        </div>
        <div class="content">
          <h2>Password Reset Request</h2>
          <p>Hello ${username},</p>
          <p>We received a request to reset your password for your Reddit Clone account. Click the button below to reset your password:</p>
          
          <div style="text-align: center;">
            <a href="${resetLink}" class="button">Reset Password</a>
          </div>
          
          <p>If the button above doesn't work, copy and paste this link into your browser:</p>
          <p><a href="${resetLink}" class="link">${resetLink}</a></p>
          
          <div class="warning">
            <p><strong>⚠️ Important:</strong> This link will expire in 1 hour.</p>
            <p>If you didn't request a password reset, please ignore this email or contact support if you're concerned about your account's security.</p>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated email from Reddit Clone. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} Reddit Clone. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,

  resendVerificationEmail: (username, verificationLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background-color: #ff4500; 
          color: white; 
          text-decoration: none; 
          border-radius: 4px; 
          font-weight: bold; 
          margin: 20px 0; 
          border: none;
          cursor: pointer;
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
          text-align: center;
        }
        .link { 
          word-break: break-all; 
          color: #0066cc; 
          text-decoration: none;
        }
        .link:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Reddit Clone</h1>
        </div>
        <div class="content">
          <h2>Verify Your Email</h2>
          <p>Hello ${username},</p>
          <p>We noticed you haven't verified your email address yet. Please click the button below to verify your email and complete your registration:</p>
          
          <div style="text-align: center;">
            <a href="${verificationLink}" class="button">Verify Email Now</a>
          </div>
          
          <p>Or use this link: <a href="${verificationLink}" class="link">${verificationLink}</a></p>
          
          <p><strong>This verification link will expire in 24 hours.</strong></p>
          
          <p><em>If you've already verified your email, you can ignore this message.</em></p>
        </div>
        <div class="footer">
          <p>This email was sent by Reddit Clone. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} Reddit Clone. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `
};

// Real email sending function
const sendEmail = async (to, subject, html) => {
  try {
    const transporter = createTransporter();
    
    // If no transporter is configured (development), log to console
    if (!transporter) {
      console.log(`📧 [DEV] Email to ${to}: ${subject}`);
      console.log(`📧 [DEV] Link: ${html.match(/href="([^"]+)"/)?.[1] || 'No link found'}`);
      return { success: true, devMode: true };
    }

    const mailOptions = {
      from: process.env.MAIL_FROM || '"Reddit Clone" <noreply@redditclone.com>',
      to,
      subject,
      html,
      text: html.replace(/<[^>]*>/g, '') // Plain text version
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    
    // If using ethereal email (development), log preview URL
    if (process.env.MAIL_SERVICE === 'ethereal' || process.env.NODE_ENV === 'development') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`📧 Preview URL: ${previewUrl}`);
      }
    }
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Register
router.post('/register', async (req, res) => {
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
      return res.status(400).json({ 
        error: 'Username or email already exists' 
      });
    }

    // Create user
    const user = new User({ username, email, password });
    
    // Generate email verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Send verification email
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${verificationToken}`;
    
    try {
      await sendEmail(
        email,
        'Verify Your Email - Reddit Clone',
        emailTemplates.verificationEmail(username, verificationLink)
      );

      // Generate temporary token (only for email verification)
      const tempToken = jwt.sign(
        { 
          userId: user._id,
          purpose: 'email_verification' 
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        message: 'Registration successful! Please check your email to verify your account.',
        userId: user._id,
        tempToken,
        emailSent: true
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Even if email fails, user is created
      res.status(201).json({
        message: 'Registration successful but verification email failed to send. Please try resending verification email.',
        userId: user._id,
        emailSent: false,
        warning: 'Email verification required'
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Registration failed. Please try again.' 
    });
  }
});

// Verify email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Invalid or expired verification token' 
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Generate proper JWT token
    const authToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Email verified successfully!',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma,
        emailVerified: user.emailVerified
      },
      token: authToken
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ 
      error: 'Email verification failed' 
    });
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({ 
        error: 'Email is already verified' 
      });
    }

    // Generate new verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Send verification email
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${verificationToken}`;
    
    try {
      await sendEmail(
        email,
        'Verify Your Email - Reddit Clone',
        emailTemplates.resendVerificationEmail(user.username, verificationLink)
      );

      res.json({
        message: 'Verification email sent successfully!',
        emailSent: true
      });
    } catch (emailError) {
      console.error('Resend verification email failed:', emailError);
      res.status(500).json({
        error: 'Failed to send verification email. Please try again later.',
        emailSent: false
      });
    }
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ 
      error: 'Failed to resend verification email' 
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username/email and password are required' 
      });
    }

    // Find user
    const user = await User.findOne({ 
      $or: [{ email: username }, { username }] 
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      const lockTime = Math.ceil((user.lockUntil - Date.now()) / 60000); // minutes
      return res.status(403).json({ 
        error: `Account is locked. Try again in ${lockTime} minutes.` 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      // Increment failed attempts
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

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(403).json({ 
        error: 'Please verify your email before logging in.',
        requiresVerification: true,
        email: user.email
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
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma,
        emailVerified: user.emailVerified
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

// Forgot password
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
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Send reset email
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    
    try {
      await sendEmail(
        email,
        'Reset Your Password - Reddit Clone',
        emailTemplates.passwordResetEmail(user.username, resetLink)
      );

      res.json({
        message: 'Password reset link sent to your email.',
        emailSent: true
      });
    } catch (emailError) {
      console.error('Password reset email failed:', emailError);
      res.status(500).json({
        error: 'Failed to send password reset email. Please try again later.',
        emailSent: false
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Failed to process password reset request' 
    });
  }
});

// Reset password
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
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Invalid or expired reset token' 
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
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

// Get current user
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

    res.json({ user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ 
      error: 'Failed to get user information' 
    });
  }
});

module.exports = router;