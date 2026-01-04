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
  authorName: {  // ADDED: Store username for easy access
    type: String,
    required: true
  },
  community: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community'
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
  // Embedded comments (as used in your routes)
  comments: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    authorName: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  score: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  votes: {  // ADDED: For backward compatibility with your routes
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

// Middleware to update score, votes, and comment count
postSchema.pre('save', function(next) {
  // Calculate votes (upvotes - downvotes)
  const upvoteCount = this.upvotes ? this.upvotes.length : 0;
  const downvoteCount = this.downvotes ? this.downvotes.length : 0;
  
  this.score = upvoteCount - downvoteCount;
  this.votes = this.score; // Keep votes for backward compatibility
  
  // Calculate comment count
  this.commentCount = this.comments ? this.comments.length : 0;
  
  next();
});

// Virtual for vote count
postSchema.virtual('voteCount').get(function() {
  return (this.upvotes?.length || 0) - (this.downvotes?.length || 0);
});

// Index for better query performance
postSchema.index({ community: 1, createdAt: -1 });
postSchema.index({ subreddit: 1, createdAt: -1 });
postSchema.index({ score: -1, createdAt: -1 });
postSchema.index({ votes: -1, createdAt: -1 });
postSchema.index({ commentCount: -1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);