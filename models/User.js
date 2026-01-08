// models/User.js - Remove email verification fields
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  karma: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // REMOVED: email verification fields
  // emailVerified: {
  //   type: Boolean,
  //   default: false
  // },
  // emailVerificationToken: String,
  // emailVerificationExpires: Date,
  // passwordResetToken: String,
  // passwordResetExpires: Date
}, {
  timestamps: true
});

// Remove email verification methods
// userSchema.methods.generateEmailVerificationToken = function() {
//   const token = crypto.randomBytes(32).toString('hex');
//   this.emailVerificationToken = token;
//   this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
//   return token;
// };

// userSchema.methods.generatePasswordResetToken = function() {
//   const token = crypto.randomBytes(32).toString('hex');
//   this.passwordResetToken = token;
//   this.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
//   return token;
// };

// Keep only essential methods
userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.incrementLoginAttempts = async function() {
  this.loginAttempts += 1;
  
  if (this.loginAttempts >= 5) {
    this.lockUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 minutes
  }
  
  await this.save();
};

userSchema.methods.resetLoginAttempts = async function() {
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  this.lastLogin = new Date();
  await this.save();
};

userSchema.methods.isLocked = function() {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema);