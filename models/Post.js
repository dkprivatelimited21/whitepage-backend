// models/Post.js
const mongoose = require('mongoose');
const slugify = require("slugify");

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },

slug: {
  type: String,
  unique: true,
  index: true
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
  authorName: {
    type: String,
    required: true
  },
  community: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community'
  },
  subreddit: {
    type: String,
    required: true
  },

externalLink: {
  url: { type: String },
  platform: { type: String }, // instagram, youtube, etc
  title: String,
  description: String,
  image: String,
  video: String,
  siteName: String
},



  // 🔹 COMMENT COUNT (REQUIRED)
  commentCount: {
    type: Number,
    default: 0
  },

  upvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  downvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  votes: {
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

postSchema.pre("save", async function (next) {
  if (!this.isModified("title")) return next();

  const baseSlug = slugify(this.title, {
    lower: true,
    strict: true,
  });

  let slug = baseSlug;
  const exists = await mongoose.models.Post.findOne({ slug });

  if (exists) {
    slug = `${baseSlug}-${this._id.toString().slice(-6)}`;
  }

  this.slug = slug;
  next();
});




// Auto-calculate vote score
postSchema.pre('save', function (next) {
  const upvoteCount = this.upvotes?.length || 0;
  const downvoteCount = this.downvotes?.length || 0;
  this.votes = upvoteCount - downvoteCount;
  next();
});

module.exports = mongoose.model('Post', postSchema);
