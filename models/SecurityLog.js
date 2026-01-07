const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  eventType: {
    type: String,
    required: true,
    index: true
  },
  ipAddress: String,
  userAgent: String,
  endpoint: String,
  method: String,
  metadata: mongoose.Schema.Types.Mixed,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  }
}, {
  timestamps: true
});

// Create compound index for efficient querying
securityLogSchema.index({ userId: 1, createdAt: -1 });
securityLogSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('SecurityLog', securityLogSchema);