const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9_]+$/.test(v);
      },
      message: 'Username can only contain letters, numbers, and underscores'
    }
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },

  // Social login IDs
  googleId: { type: String, unique: true, sparse: true },
  githubId: { type: String, unique: true, sparse: true },
  facebookId: { type: String, unique: true, sparse: true },
  
  // Profile picture URL
  profilePicture: {
    type: String,
    default: ''
  },

  // User bio
  bio: {
    type: String,
    maxlength: 500,
    default: ''
  },

  // Social media links
  socialLinks: [{
    platform: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      validate: {
        validator: function(v) {
          return /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(v);
        },
        message: 'Please enter a valid URL'
      }
    }
  }],

  // User karma/points system
  karma: {
    type: Number,
    default: 0
  },

  // Account status
  isActive: {
    type: Boolean,
    default: true
  },

  // Email verification (optional)
  emailVerified: {
    type: Boolean,
    default: false
  },

  // Login security
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },

  // Password reset
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // Account creation and activity
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },

  // Optional: User preferences
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  }

}, {
  timestamps: true,
  toJSON: {
    virtuals: false, // Temporarily disable virtuals to fix 500 error
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.resetPasswordToken;
      delete ret.resetPasswordExpires;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      
      // Manually add formatted date if createdAt exists
      if (doc.createdAt && doc.createdAt instanceof Date && !isNaN(doc.createdAt.getTime())) {
        try {
          ret.joinDate = doc.createdAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        } catch (error) {
          ret.joinDate = 'Unknown date';
        }
      } else {
        ret.joinDate = 'Unknown date';
      }
      
      // Manually calculate account age if needed
      if (doc.createdAt && doc.createdAt instanceof Date && !isNaN(doc.createdAt.getTime())) {
        const diff = Date.now() - doc.createdAt.getTime();
        ret.accountAge = Math.floor(diff / (1000 * 60 * 60 * 24));
        ret.isNewUser = ret.accountAge < 30;
      } else {
        ret.accountAge = 0;
        ret.isNewUser = false;
      }
      
      // Add profile URL
      if (doc.username) {
        ret.profileUrl = `/user/${doc.username}`;
      }
      
      return ret;
    }
  },
  toObject: {
    virtuals: false, // Temporarily disable virtuals to fix 500 error
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.resetPasswordToken;
      delete ret.resetPasswordExpires;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      
      // Manually add formatted date if createdAt exists
      if (doc.createdAt && doc.createdAt instanceof Date && !isNaN(doc.createdAt.getTime())) {
        try {
          ret.joinDate = doc.createdAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        } catch (error) {
          ret.joinDate = 'Unknown date';
        }
      } else {
        ret.joinDate = 'Unknown date';
      }
      
      // Manually calculate account age if needed
      if (doc.createdAt && doc.createdAt instanceof Date && !isNaN(doc.createdAt.getTime())) {
        const diff = Date.now() - doc.createdAt.getTime();
        ret.accountAge = Math.floor(diff / (1000 * 60 * 60 * 24));
        ret.isNewUser = ret.accountAge < 30;
      } else {
        ret.accountAge = 0;
        ret.isNewUser = false;
      }
      
      // Add profile URL
      if (doc.username) {
        ret.profileUrl = `/user/${doc.username}`;
      }
      
      return ret;
    }
  }
});

// ============================================
// TEMPORARILY COMMENTED OUT VIRTUAL PROPERTIES
// ============================================
/*
// Virtual for user's full profile URL
userSchema.virtual('profileUrl').get(function() {
  return `/user/${this.username}`;
});

// Virtual for user's join date in readable format
userSchema.virtual('joinDate').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

// Virtual for account age in days
userSchema.virtual('accountAge').get(function() {
  const diff = Date.now() - this.createdAt.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

// Check if user is new (less than 30 days)
userSchema.virtual('isNewUser').get(function() {
  return this.accountAge < 30;
});
*/
// ============================================
// END OF COMMENTED VIRTUAL PROPERTIES
// ============================================

// Essential methods
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

// Add social link
userSchema.methods.addSocialLink = function(platform, url) {
  if (!this.socialLinks) {
    this.socialLinks = [];
  }
  
  // Check if platform already exists
  const existingIndex = this.socialLinks.findIndex(link => 
    link.platform.toLowerCase() === platform.toLowerCase()
  );
  
  if (existingIndex > -1) {
    // Update existing link
    this.socialLinks[existingIndex].url = url;
  } else {
    // Add new link
    this.socialLinks.push({ platform, url });
  }
  
  return this.socialLinks;
};

// Remove social link
userSchema.methods.removeSocialLink = function(platform) {
  if (!this.socialLinks) return [];
  
  this.socialLinks = this.socialLinks.filter(link => 
    link.platform.toLowerCase() !== platform.toLowerCase()
  );
  
  return this.socialLinks;
};

// Get social link by platform
userSchema.methods.getSocialLink = function(platform) {
  if (!this.socialLinks) return null;
  
  return this.socialLinks.find(link => 
    link.platform.toLowerCase() === platform.toLowerCase()
  ) || null;
};

// Helper method to safely get createdAt date
userSchema.methods.getSafeCreatedAt = function() {
  if (!this.createdAt) return new Date();
  if (this.createdAt instanceof Date && !isNaN(this.createdAt.getTime())) {
    return this.createdAt;
  }
  if (typeof this.createdAt === 'string') {
    const parsed = new Date(this.createdAt);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update lastLogin on login
userSchema.pre('findOneAndUpdate', async function(next) {
  if (this._update.lastLogin) {
    this._update.lastLogin = new Date();
  }
  next();
});

// Indexes for better query performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ githubId: 1 }, { sparse: true });
userSchema.index({ facebookId: 1 }, { sparse: true });
userSchema.index({ karma: -1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);