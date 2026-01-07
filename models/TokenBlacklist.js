const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  reason: {
    type: String,
    enum: ['logout', 'revoked', 'compromised', 'password_change'],
    default: 'logout'
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);