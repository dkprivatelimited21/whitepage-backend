// models/Comment.js
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  authorName: {
    type: String,
    required: true
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  },
  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],
  upvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  downvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  voteCount: {
    type: Number,
    default: 0
  },
depth: {
  type: Number,
  default: 0
},
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Update voteCount before saving
commentSchema.pre('save', function(next) {
  const upvotesCount = this.upvotes ? this.upvotes.length : 0;
  const downvotesCount = this.downvotes ? this.downvotes.length : 0;
  this.voteCount = upvotesCount - downvotesCount;
  next();
});

module.exports = mongoose.model('Comment', commentSchema);