const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const mongoose = require('mongoose'); // Added for ObjectId validation
const MAX_CONTENT_LENGTH = 2000;
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const ogs = require('open-graph-scraper');


const ALLOWED_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'snapchat.com'
];

function extractLinks(text = '') {
  return text.match(URL_REGEX) || [];
}

function isAllowedPlatform(url) {
  return ALLOWED_DOMAINS.some(domain => url.includes(domain));
}

function detectPlatform(url) {
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('snapchat.com')) return 'snapchat';
  return 'unknown';
}


router.post('/preview-link', auth, async (req, res) => {
  const { url } = req.body;

  if (!isAllowedPlatform(url)) {
    return res.status(400).json({ error: 'Platform not supported' });
  }

 let result;
try {
  const ogResponse = await ogs({ url });
  result = ogResponse.result;
} catch (err) {
  return res.status(400).json({ error: 'Failed to fetch link preview' });
}

  res.json({
    title: result.ogTitle,
    description: result.ogDescription,
    image: result.ogImage?.url,
    video: result.ogVideo?.url,
    siteName: result.ogSiteName
  });
});

// ====================
// STATIC ROUTES (MUST BE BEFORE /:id)
// ====================

// GET /api/posts/count - Get total post count
router.get('/count', async (req, res) => {
  try {
    const count = await Post.countDocuments();
    res.json({ 
      success: true, 
      count 
    });
  } catch (error) {
    console.error('Error getting post count:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get post count' 
    });
  }
});

// GET /api/posts - Get posts with pagination
router.get('/', async (req, res, next) => {
  try {
    const { subreddit, sort = 'new', page = 1, limit = 10 } = req.query;
    let query = {};
    if (subreddit) query.subreddit = subreddit.toLowerCase();

    let sortOption = {};
    if (sort === 'hot' || sort === 'top') sortOption = { votes: -1 };
    else sortOption = { createdAt: -1 };

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username karma');

    const normalizedPosts = posts.map(post => ({
      _id: post._id,
      title: post.title,
      content: post.content,
      subreddit: post.subreddit,
      createdAt: post.createdAt || new Date(),
      authorId: post.author?._id,
      authorName: post.author?.username,

      authorKarma: post.author?.karma,
externalLink: post.externalLink
    }));

    const total = await Post.countDocuments(query);

    res.json({ 
      posts: normalizedPosts,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total
    });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

// Get popular subreddits
router.get('/subreddits', async (req, res) => {
  try {
    const subreddits = await Post.aggregate([
      { $group: { _id: '$subreddit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    res.json({ 
      success: true,
      subreddits 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /api/posts/trending - Get trending posts
router.get('/trending', async (req, res) => {
  try {
    // Get posts from the last 48 hours for trending
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const posts = await Post.find({
      createdAt: { $gte: twoDaysAgo }
    })
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .limit(20);
    
    // Calculate trending score for each post
    const postsWithScore = posts.map(post => {
      const hoursSinceCreated = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
      
      // Calculate score: upvotes + comments - age penalty
      const upvoteCount = post.upvotes ? post.upvotes.length : 0;
      const commentCount = post.commentCount || 0;
      const score = (upvoteCount * 2) + commentCount - (hoursSinceCreated * 0.2);
      
      return {
        ...post.toObject(),
        trendingScore: score
      };
    });
    
    // Sort by trending score
    postsWithScore.sort((a, b) => b.trendingScore - a.trendingScore);
    
    // Take top 5
    const trendingPostsResult = postsWithScore.slice(0, 5);
    
    res.json({
      success: true,
      posts: trendingPostsResult
    });
  } catch (error) {
    console.error('Error fetching trending posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending posts'
    });
  }
});

// Alternative simpler trending algorithm
router.get('/trending/simple', async (req, res) => {
  try {
    // Get posts from the last 7 days
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const trendingPosts = await Post.find({
      createdAt: { $gte: oneWeekAgo }
    })
    .populate('author', 'username')
    .sort({ 
      // Sort by upvotes first, then comments, then recency
      createdAt: -1
    })
    .limit(5);
    
    res.json({
      success: true,
      posts: trendingPosts
    });
  } catch (error) {
    console.error('Error fetching trending posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending posts'
    });
  }
});

// Get user's posts
router.get('/user/:username/posts', async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const posts = await Post.find({ authorName: username })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username');

    const total = await Post.countDocuments({ authorName: username });

    res.json({
      success: true,
      posts,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get user profile with posts
router.get('/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 1. Find user
    const user = await User.findOne({ username }).select('_id username karma createdAt bio');
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // 2. Find posts
    const [posts, total] = await Promise.all([
      Post.find({ author: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', 'username karma'),
      Post.countDocuments({ author: user._id })
    ]);

    res.json({
      success: true,
      user,
      posts,
      page,
      totalPages: Math.ceil(total / limit),
      totalPosts: total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

// ====================
// DYNAMIC ROUTES (/:id) - MUST BE AFTER ALL STATIC ROUTES
// ====================

// Create post
router.post('/', auth, async (req, res) => {
  try {
    const { title, content = '', subreddit } = req.body;


// Content limit
if (content.length > MAX_CONTENT_LENGTH) {
  return res.status(400).json({ error: 'Post exceeds character limit' });
}

// Extract links
const links = extractLinks(content);

// Enforce ONE link
if (links.length > 1) {
  return res.status(400).json({ error: 'Only one external link allowed per post' });
}

let externalLink = null;

if (links.length === 1) {
  const url = links[0];

try {
  new URL(url);
} catch {
  return res.status(400).json({ error: 'Invalid URL' });
}


  if (!isAllowedPlatform(url)) {
    return res.status(400).json({ error: 'Unsupported platform link' });
  }

let result = {};
try {
  const ogResponse = await ogs({ url });
  result = ogResponse.result || {};
} catch (err) {
  // Allow post creation without preview metadata
  result = {};
}

externalLink = {
  url,
  platform: detectPlatform(url),
  title: result.ogTitle,
  description: result.ogDescription,
  image: result.ogImage?.url,
  video: result.ogVideo?.url,
  siteName: result.ogSiteName
};


}


   const post = new Post({
  title,
  content,
  subreddit: subreddit.toLowerCase(),
  author: req.user._id,
  authorName: req.user.username,
  externalLink
});
    await post.save();
    res.status(201).json({ 
      success: true,
      post 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get single post - THIS MUST BE AFTER ALL OTHER SPECIFIC ROUTES!
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check for special routes that might have slipped through
    if (id === 'count' || id === 'trending' || id === 'subreddits' || id === 'user') {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID format' 
      });
    }

    const post = await Post.findById(id)
      .populate('author', 'username karma');

    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    res.json({ 
      success: true,
      post 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Add comment (NEW Comment model system)
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.id;

    if (!content || !content.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Comment content is required' 
      });
    }

    // Verify post exists
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    // Create comment
    const comment = new Comment({
      content: content.trim(),
      author: req.user._id,
      authorName: req.user.username,
      post: postId
    });

    await comment.save();

    // Update post comment count
    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    // Populate author before sending
    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'username')
      .lean();

    res.status(201).json({
      success: true,
      comment: populatedComment
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create comment'
    });
  }
});

// Get comments for a post (top-level + replies)
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { sort = 'best', limit = 100 } = req.query;

    // Validate post ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }

    let sortOption;
    switch (sort) {
      case 'new':
        sortOption = { createdAt: -1 };
        break;
      case 'old':
        sortOption = { createdAt: 1 };
        break;
      case 'top':
        sortOption = { voteCount: -1 };
        break;
      case 'best':
      default:
        sortOption = { voteCount: -1, createdAt: -1 };
    }

    // Fetch top-level comments ONLY
    const comments = await Comment.find({
      post: id,
      parentComment: null
    })
      .sort(sortOption)
      .limit(parseInt(limit))
      .populate('author', 'username avatar')
      .lean();

    // Fetch replies for each comment
    for (const comment of comments) {
      const replies = await Comment.find({
        parentComment: comment._id
      })
        .sort({ createdAt: 1 })
        .populate('author', 'username avatar')
        .lean();

      // Calculate vote count for replies
      replies.forEach(reply => {
        reply.voteCount =
          (reply.upvotes?.length || 0) - (reply.downvotes?.length || 0);
      });

      comment.replies = replies;

      // Calculate vote count for top-level comment
      comment.voteCount =
        (comment.upvotes?.length || 0) - (comment.downvotes?.length || 0);
    }

    res.json({
      success: true,
      comments
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments'
    });
  }
});

// Add nested comment
router.post('/:postId/comments/:commentId/reply', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const { postId, commentId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid ID format' 
      });
    }

    // Find parent comment
    const parentComment = await Comment.findById(commentId);
    if (!parentComment) {
      return res.status(404).json({ 
        success: false,
        error: 'Comment not found' 
      });
    }

    // Create reply
    const reply = new Comment({
      content,
      author: req.user._id,
      authorName: req.user.username,
      post: postId,
      parentComment: commentId,
      depth: (parentComment.depth || 0) + 1
    });

    await reply.save();

    // Add reply to parent's replies array
    if (!parentComment.replies) {
      parentComment.replies = [];
    }
    parentComment.replies.push(reply._id);
    await parentComment.save();

    // Create notification for parent comment author
    if (parentComment.author.toString() !== req.user._id.toString()) {
      await Notification.create({
        user: parentComment.author,
        type: 'comment_reply',
        sender: req.user._id,
        senderName: req.user.username,
        post: postId,
        comment: reply._id,
        message: `${req.user.username} replied to your comment`,
        link: `/post/${postId}#comment-${reply._id}`
      });
    }

    res.status(201).json({ 
      success: true, 
      comment: reply 
    });
  } catch (error) {
    console.error('Error creating reply:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Delete post
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }

    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        error: 'Not authorized to delete this post' 
      });
    }

    await Post.findByIdAndDelete(id);
    res.json({ 
      success: true,
      message: 'Post deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Delete comment (and its replies)
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid ID format' 
      });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ 
        success: false,
        error: 'Comment not found' 
      });
    }

    // Author-only delete
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        error: 'Not authorized to delete this comment' 
      });
    }

    // Count how many comments will be removed (comment + replies)
    const repliesCount = await Comment.countDocuments({ parentComment: commentId });

    // Delete main comment
    await Comment.findByIdAndDelete(commentId);

    // Delete all direct replies
    await Comment.deleteMany({ parentComment: commentId });

    // Update post comment count correctly
    const post = await Post.findById(postId);
    if (post) {
      post.commentCount = Math.max(
        0,
        (post.commentCount || 0) - (1 + repliesCount)
      );
      await post.save();
    }

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete comment'
    });
  }
});

// Vote on comment
router.post('/comments/:commentId/vote', auth, async (req, res) => {
  try {
    const { type } = req.body; // 'upvote' or 'downvote'
    const { commentId } = req.params;

    // Validate commentId
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid comment ID' 
      });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ 
        success: false,
        error: 'Comment not found' 
      });
    }

    // Remove existing votes
    comment.upvotes = comment.upvotes.filter(
      id => id.toString() !== req.user._id.toString()
    );
    comment.downvotes = comment.downvotes.filter(
      id => id.toString() !== req.user._id.toString()
    );

    // Add new vote
    if (type === 'upvote') {
      comment.upvotes.push(req.user._id);
      
      // Create notification for upvote
      if (comment.author.toString() !== req.user._id.toString()) {
        await Notification.create({
          user: comment.author,
          type: 'upvote',
          sender: req.user._id,
          senderName: req.user.username,
          post: comment.post,
          comment: comment._id,
          message: `${req.user.username} upvoted your comment`,
          link: `/post/${comment.post}#comment-${comment._id}`
        });
      }
    } else if (type === 'downvote') {
      comment.downvotes.push(req.user._id);
    } else {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid vote type' 
      });
    }

    await comment.save();

    res.json({ 
      success: true, 
      upvotes: comment.upvotes.length,
      downvotes: comment.downvotes.length,
      voteCount: comment.upvotes.length - comment.downvotes.length
    });
  } catch (error) {
    console.error('Error voting on comment:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

module.exports = router;