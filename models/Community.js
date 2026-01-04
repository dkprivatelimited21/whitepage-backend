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
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// REMOVE THIS VIRTUAL (it conflicts with the real memberCount field)
// communitySchema.virtual('memberCount').get(function() {
//   return this.members ? this.members.length : 0;
// });

// Instead, update the real memberCount field automatically
communitySchema.pre('save', function(next) {
  // Update memberCount based on members array length
  this.memberCount = this.members ? this.members.length : 0;
  next();
});

// Add a virtual for calculated member count if needed
communitySchema.virtual('calculatedMemberCount').get(function() {
  return this.members ? this.members.length : 0;
});

// Add a virtual for the community URL
communitySchema.virtual('url').get(function() {
  return `/r/${this.name}`;
});

module.exports = mongoose.model('Community', communitySchema);