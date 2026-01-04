// models/Community.js
const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  rules: [{
    type: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  memberCount: {
    type: Number,
    default: 1 // Starts with creator as member
  },
  postCount: {
    type: Number,
    default: 0
  },
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual for member count
communitySchema.virtual('memberCount').get(function() {
  return this.members ? this.members.length : 0;
});

// Middleware to update member count
communitySchema.pre('save', function(next) {
  this.memberCount = this.members ? this.members.length : 0;
  next();
});

module.exports = mongoose.model('Community', communitySchema);