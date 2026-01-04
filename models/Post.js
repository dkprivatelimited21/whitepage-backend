// models/Post.js
const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  community: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true
  },
  // Keep subreddit for backward compatibility
  subreddit: {
    type: String,
    required: true
  },
  upvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  downvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],
  score: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Middleware to update score and comment count
postSchema.pre('save', function(next) {
  this.score = this.upvotes.length - this.downvotes.length;
  this.commentCount = this.comments ? this.comments.length : 0;
  next();
});

// Index for better query performance
postSchema.index({ community: 1, createdAt: -1 });
postSchema.index({ score: -1, createdAt: -1 });
postSchema.index({ commentCount: -1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);