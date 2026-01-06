// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['comment_reply', 'post_reply', 'upvote', 'downvote', 'mention', 'new_follower'],
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  senderName: {
    type: String
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },
  comment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  },
  message: {
    type: String
  },
  isRead: {
    type: Boolean,
    default: false
  },
  link: {
    type: String
  },
  // Add these for better context
  postTitle: {
    type: String
  },
  commentContent: {
    type: String,
    maxlength: 200
  }
}, {
  timestamps: true
});

// Index for performance
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

// Add compound index for preventing duplicate notifications
notificationSchema.index({ 
  user: 1, 
  type: 1, 
  sender: 1, 
  post: 1, 
  comment: 1 
}, { unique: true });

module.exports = mongoose.model('Notification', notificationSchema);