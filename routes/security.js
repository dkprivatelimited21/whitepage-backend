const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SecurityLog = require('../models/SecurityLog');
const rateLimit = require('express-rate-limit');

// Rate limiting for security endpoints
const securityRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: (req) => req.user?.role === 'admin'
});

router.use(auth.requireRole(['admin', 'security']));

// Get security logs
router.get('/logs', securityRateLimiter, async (req, res) => {
  try {
    const { page = 1, limit = 50, eventType, userId, severity, startDate, endDate } = req.query;
    
    const query = {};
    if (eventType) query.eventType = eventType;
    if (userId) query.userId = userId;
    if (severity) query.severity = severity;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const logs = await SecurityLog.find(query)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('userId', 'username email');
    
    const total = await SecurityLog.countDocuments(query);
    
    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get security statistics
router.get('/stats', async (req, res) => {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const stats = await SecurityLog.aggregate([
      {
        $match: {
          createdAt: { $gte: last24h }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          bySeverity: {
            $push: {
              severity: '$severity',
              count: 1
            }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get failed login attempts
router.get('/failed-logins', async (req, res) => {
  try {
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    
    const failedLogins = await SecurityLog.aggregate([
      {
        $match: {
          eventType: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN', 'BLACKLISTED_TOKEN_ACCESS'] },
          createdAt: { $gte: lastHour }
        }
      },
      {
        $group: {
          _id: '$ipAddress',
          attempts: { $sum: 1 },
          lastAttempt: { $max: '$createdAt' }
        }
      },
      {
        $sort: { attempts: -1 }
      },
      {
        $limit: 100
      }
    ]);
    
    res.json({ failedLogins });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;