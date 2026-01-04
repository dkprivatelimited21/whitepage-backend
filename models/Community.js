const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 21
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  owner: {
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
    ref: 'User',
    default: []
  }],
  memberCount: {
    type: Number,
    default: 1
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  isNSFW: {
    type: Boolean,
    default: false
  },
  rules: [{
    title: String,
    description: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  icon: String,
  banner: String,
  primaryColor: {
    type: String,
    default: '#FF4500'
  }
});

module.exports = mongoose.model('Community', communitySchema);