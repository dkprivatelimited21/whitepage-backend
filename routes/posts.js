const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const mongoose = require('mongoose');
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

// ====================
// VOTE ROUTES (CRITICAL - MUST BE ADDED)
// ====================

/* ---------------------------------------------------
   VOTE ON POST - This route is called from Post.jsx and PostDetail.jsx
--------------------------------------------------- */
router.post('/votes/:postId/:type', auth, async (req, res) => {
  try {
    const { postId, type } = req.params;
    
    // Validate parameters
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }
    
    if (!['upvote', 'downvote'].includes(type)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid vote type' 
      });
    }
    
    // Find the post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }
    
    // Check if user is the post author (optional: prevent self-voting)
    if (post.author.toString() === req.user._id.toString()) {
      return res.status(400).json({ 
        success: false,
        error: 'You cannot vote on your own post' 
      });
    }
    
    // Convert user ID to string for comparison
    const userId = req.user._id.toString();
    
    // Check existing votes
    const hasUpvoted = post.upvotes?.some(id => id.toString() === userId) || false;
    const hasDownvoted = post.downvotes?.some(id => id.toString() === userId) || false;
    
    let updatedPost;
    
    if (type === 'upvote') {
      if (hasUpvoted) {
        // Remove upvote if already upvoted
        post.upvotes = post.upvotes.filter(id => id.toString() !== userId);
      } else {
        // Add upvote and remove downvote if exists
        if (hasDownvoted) {
          post.downvotes = post.downvotes.filter(id => id.toString() !== userId);
        }
        post.upvotes.push(req.user._id);
      }
    } else if (type === 'downvote') {
      if (hasDownvoted) {
        // Remove downvote if already downvoted
        post.downvotes = post.downvotes.filter(id => id.toString() !== userId);
      } else {
        // Add downvote and remove upvote if exists
        if (hasUpvoted) {
          post.upvotes = post.upvotes.filter(id => id.toString() !== userId);
        }
        post.downvotes.push(req.user._id);
      }
    }
    
    // Recalculate vote count
    const upvoteCount = post.upvotes?.length || 0;
    const downvoteCount = post.downvotes?.length || 0;
    post.votes = upvoteCount - downvoteCount;
    
    // Track user's vote for quick lookup
    const userVote = post.upvotes.some(id => id.toString() === userId) ? 'upvote' :
                    post.downvotes.some(id => id.toString() === userId) ? 'downvote' : null;
    
    // Save the updated post
    await post.save();
    
    // Populate author for response
    updatedPost = await Post.findById(postId)
      .populate('author', 'username');
    
    // Update user's karma if applicable
    if (type === 'upvote' && !hasUpvoted) {
      await User.findByIdAndUpdate(post.author, { $inc: { karma: 1 } });
    } else if (type === 'downvote' && !hasDownvoted) {
      await User.findByIdAndUpdate(post.author, { $inc: { karma: -1 } });
    }
    
    // Create notification for vote
    if ((type === 'upvote' && !hasUpvoted) || (type === 'downvote' && !hasDownvoted)) {
      await Notification.create({
        user: post.author,
        type: type,
        sender: req.user._id,
        senderName: req.user.username,
        post: postId,
        message: `${req.user.username} ${type === 'upvote' ? 'upvoted' : 'downvoted'} your post`,
        link: `/post/${postId}`
      });
    }
    
    res.json({
      success: true,
      votes: post.votes,
      upvoteCount: upvoteCount,
      downvoteCount: downvoteCount,
      hasUpvoted: post.upvotes.some(id => id.toString() === userId),
      hasDownvoted: post.downvotes.some(id => id.toString() === userId),
      userVote: userVote,
      post: updatedPost
    });
    
  } catch (error) {
    console.error('Error voting on post:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process vote' 
    });
  }
});

/* ---------------------------------------------------
   GET POST VOTE STATUS (for current user)
--------------------------------------------------- */
router.get('/votes/:postId/status', auth, async (req, res) => {
  try {
    const { postId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }
    
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }
    
    const userId = req.user._id.toString();
    const hasUpvoted = post.upvotes?.some(id => id.toString() === userId) || false;
    const hasDownvoted = post.downvotes?.some(id => id.toString() === userId) || false;
    
    res.json({
      success: true,
      hasUpvoted,
      hasDownvoted,
      userVote: hasUpvoted ? 'upvote' : hasDownvoted ? 'downvote' : null,
      votes: post.votes || 0
    });
    
  } catch (error) {
    console.error('Error getting vote status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get vote status' 
    });
  }
});

/* ---------------------------------------------------
   PREVIEW LINK - MUST BE BEFORE DYNAMIC ROUTES
--------------------------------------------------- */
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
router.get('/', async (req, res) => {
  try {
    const { subreddit, sort = 'new', page = 1, limit = 10 } = req.query;
    let query = {};
    if (subreddit) query.subreddit = subreddit.toLowerCase();

    let sortOption = {};
    if (sort === 'hot' || sort === 'top') sortOption = { votes: -1 };
    else if (sort === 'best') sortOption = { votes: -1, createdAt: -1 };
    else sortOption = { createdAt: -1 };

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username karma');

    // Format posts for response with user vote status
    const formattedPosts = posts.map(post => {
      const postObj = post.toObject();
      const userId = req.user?._id?.toString();
      
      // Calculate user's vote status for each post
      const userVote = post.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                      post.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
      
      return {
        ...postObj,
        votes: post.votes || 0,
        userVote: userVote,
        authorName: post.author?.username,
        commentCount: post.commentCount || 0
      };
    });

    const total = await Post.countDocuments(query);

    res.json({ 
      success: true,
      posts: formattedPosts,
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
        trendingScore: score,
        votes: post.votes || 0,
        commentCount: commentCount
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
      // Sort by vote score first, then comments, then recency
      votes: -1,
      commentCount: -1,
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
    const user = await User.findOne({ username }).select('_id username karma createdAt bio socialLinks');
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

    // Format posts with user vote status
    const formattedPosts = posts.map(post => {
      const postObj = post.toObject();
      const userId = req.user?._id?.toString();
      
      const userVote = post.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                      post.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
      
      return {
        ...postObj,
        votes: post.votes || 0,
        userVote: userVote,
        authorName: post.author?.username,
        commentCount: post.commentCount || 0
      };
    });

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        karma: user.karma || 0,
        createdAt: user.createdAt,
        bio: user.bio || '',
        socialLinks: user.socialLinks || []
      },
      posts: formattedPosts,
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

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Title is required' 
      });
    }
    
    if (!subreddit || !subreddit.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Community is required' 
      });
    }

    // Content limit
    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ 
        success: false,
        error: 'Post exceeds character limit' 
      });
    }

    // Extract links
    const links = extractLinks(content);

    // Enforce ONE link
    if (links.length > 1) {
      return res.status(400).json({ 
        success: false,
        error: 'Only one external link allowed per post' 
      });
    }

    let externalLink = null;

    if (links.length === 1) {
      const url = links[0];

      try {
        new URL(url);
      } catch {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid URL' 
        });
      }

      if (!isAllowedPlatform(url)) {
        return res.status(400).json({ 
          success: false,
          error: 'Unsupported platform link' 
        });
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
      title: title.trim(),
      content: content.trim(),
      subreddit: subreddit.toLowerCase().trim(),
      author: req.user._id,
      authorName: req.user.username,
      externalLink,
      votes: 0,
      commentCount: 0
    });
    
    await post.save();
    
    // Populate author for response
    const populatedPost = await Post.findById(post._id)
      .populate('author', 'username karma');
    
    res.status(201).json({ 
      success: true,
      post: populatedPost,
      message: 'Post created successfully'
    });
  } catch (error) {
    console.error('Error creating post:', error);
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
      .populate('author', 'username karma bio socialLinks');

    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    // Increment view count
    post.viewCount = (post.viewCount || 0) + 1;
    await post.save();

    // Determine user's vote status if authenticated
    let userVote = null;
    if (req.headers.authorization) {
      try {
        // Extract token and decode to get user ID
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        
        userVote = post.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                   post.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
      } catch (error) {
        // Token might be invalid or expired, just continue without user vote
      }
    }

    // Format the response
    const responsePost = post.toObject();
    responsePost.userVote = userVote;
    responsePost.votes = post.votes || 0;
    responsePost.commentCount = post.commentCount || 0;
    responsePost.authorName = post.author?.username;

    res.json({ 
      success: true,
      post: responsePost
    });
  } catch (error) {
    console.error('Error fetching post:', error);
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
      post: postId,
      upvotes: [],
      downvotes: [],
      voteCount: 0
    });

    await comment.save();

    // Update post comment count
    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    // Populate author before sending
    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'username')
      .lean();

    // Create notification for post author
    if (post.author.toString() !== req.user._id.toString()) {
      await Notification.create({
        user: post.author,
        type: 'comment',
        sender: req.user._id,
        senderName: req.user.username,
        post: postId,
        comment: comment._id,
        message: `${req.user.username} commented on your post`,
        link: `/post/${postId}#comment-${comment._id}`
      });
    }

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
      .populate('author', 'username')
      .lean();

    // Determine user vote status for each comment if authenticated
    let userId = null;
    if (req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (error) {
        // Token invalid, proceed without user vote info
      }
    }

    // Fetch replies for each comment
    for (const comment of comments) {
      const replies = await Comment.find({
        parentComment: comment._id
      })
        .sort({ createdAt: 1 })
        .populate('author', 'username')
        .lean();

      // Calculate vote count and user vote for replies
      replies.forEach(reply => {
        const upvoteCount = reply.upvotes?.length || 0;
        const downvoteCount = reply.downvotes?.length || 0;
        reply.voteCount = upvoteCount - downvoteCount;
        
        // Add user vote status if authenticated
        if (userId) {
          reply.userVote = reply.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                          reply.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
        }
      });

      comment.replies = replies;

      // Calculate vote count for top-level comment
      const upvoteCount = comment.upvotes?.length || 0;
      const downvoteCount = comment.downvotes?.length || 0;
      comment.voteCount = upvoteCount - downvoteCount;
      
      // Add user vote status if authenticated
      if (userId) {
        comment.userVote = comment.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                          comment.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
      }
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

    // Delete associated comments
    await Comment.deleteMany({ post: id });
    
    // Delete the post
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

    // Convert user ID to string for comparison
    const userId = req.user._id.toString();

    // Check existing votes
    const hasUpvoted = comment.upvotes?.some(id => id.toString() === userId) || false;
    const hasDownvoted = comment.downvotes?.some(id => id.toString() === userId) || false;

    // Remove existing votes
    comment.upvotes = comment.upvotes.filter(
      id => id.toString() !== userId
    );
    comment.downvotes = comment.downvotes.filter(
      id => id.toString() !== userId
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

    // Calculate new vote count
    const upvoteCount = comment.upvotes.length || 0;
    const downvoteCount = comment.downvotes.length || 0;
    comment.voteCount = upvoteCount - downvoteCount;

    await comment.save();

    res.json({ 
      success: true, 
      upvotes: upvoteCount,
      downvotes: downvoteCount,
      voteCount: comment.voteCount,
      hasUpvoted: comment.upvotes.some(id => id.toString() === userId),
      hasDownvoted: comment.downvotes.some(id => id.toString() === userId)
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