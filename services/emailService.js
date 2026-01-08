// services/emailService.js
const nodemailer = require('nodemailer');

// Create email transporter
const createTransporter = () => {
  // Choose email provider based on environment variables
  const mailService = process.env.MAIL_SERVICE || 'gmail';
  
  let transporterConfig;
  
  if (mailService === 'gmail') {
    // Gmail configuration (requires two-factor authentication and app-specific password)
    transporterConfig = {
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD // Note: Not regular password, but app-specific password
      }
    };
  } else if (mailService === 'sendgrid') {
    // SendGrid configuration
    transporterConfig = {
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    };
  } else if (mailService === 'smtp') {
    // Custom SMTP server configuration
    transporterConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    };
  } else {
    throw new Error('Unsupported mail service');
  }

  return nodemailer.createTransport(transporterConfig);
};

// Send email function
const sendEmail = async (to, subject, html) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.MAIL_FROM || '"Reddit Clone" <noreply@redditclone.com>',
      to,
      subject,
      html,
      // Optional: add text version
      text: html.replace(/<[^>]*>/g, '')
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    console.log(`📧 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('❌ Email sending error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Email templates for specific purposes
const emailTemplates = {
  // Verification email template
  verificationEmail: (username, verificationLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; }
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
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
        }
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
          <p><a href="${verificationLink}" style="word-break: break-all;">${verificationLink}</a></p>
          
          <p>This verification link will expire in 24 hours.</p>
          
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

  // Password reset email template
  passwordResetEmail: (username, resetLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; }
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
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
        }
        .warning { 
          background-color: #fff3cd; 
          border: 1px solid #ffeaa7; 
          padding: 15px; 
          border-radius: 4px; 
          margin: 20px 0; 
        }
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
          <p><a href="${resetLink}" style="word-break: break-all;">${resetLink}</a></p>
          
          <div class="warning">
            <p><strong>⚠️ This link will expire in 1 hour.</strong></p>
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

  // Resend verification email template
  resendVerificationEmail: (username, verificationLink) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ff4500; color: white; padding: 20px; text-align: center; }
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
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #ddd; 
          font-size: 12px; 
          color: #666; 
        }
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
          
          <p>Or use this link: <a href="${verificationLink}">${verificationLink}</a></p>
          
          <p>This verification link will expire in 24 hours.</p>
          
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

module.exports = {
  sendEmail,
  emailTemplates
};