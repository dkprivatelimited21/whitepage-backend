// routes/test.js
const express = require('express');
const router = express.Router();
const { sendEmail, emailTemplates } = require('../services/emailService');

router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const testLink = `${process.env.FRONTEND_URL}/test`;
    
    const result = await sendEmail(
      email,
      'Test Email - Reddit Clone',
      emailTemplates.verificationEmail('Test User', testLink)
    );
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      result
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;