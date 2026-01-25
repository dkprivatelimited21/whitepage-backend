
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
const authMiddleware = require('../middleware/auth');
const slugify = require('slugify');

function extractLinks(text = '') {
  return text.match(URL_REGEX) || [];
}

function detectPlatform(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) return 'facebook';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('snapchat.com')) return 'snapchat';
    if (hostname.includes('reddit.com')) return 'reddit';
    if (hostname.includes('imgur.com')) return 'imgur';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('pinterest.com')) return 'pinterest';
    if (hostname.includes('linkedin.com')) return 'linkedin';
    if (hostname.includes('github.com')) return 'github';
    if (hostname.includes('medium.com')) return 'medium';
    
    return 'website';
  } catch (error) {
    return 'unknown';
  }
}

// ====================
// CONTENT FILTERING MIDDLEWARE
// ====================

const applyContentFilter = (req, query) => {
  const showAdult = req.query.showAdult === 'true';
  const user = req.user;
  
  // For authenticated users, check their preference
  if (user) {
    const userPref = user.allowAdultContent || false;
    if (!userPref) {
      query.isAdult = false;
    } else if (!showAdult) {
      query.isAdult = false;
    }
  } else {
    // For guest users, always hide adult content
    query.isAdult = false;
  }
  
  return query;
};

// ====================
// VOTE ROUTES
// ====================

router.post('/votes/:postId/:type', auth, async (req, res) => {
  try {
    const { postId, type } = req.params;
    
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
    
    // Find post by ID or slug
    const post = await Post.findOne({
      $or: [
        { _id: postId },
        { slug: postId }
      ]
    });
    
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
    
    // Save the updated post
    await post.save();
    
    // Populate author for response
    updatedPost = await Post.findById(post._id)
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
        post: post._id,
        message: `${req.user.username} ${type === 'upvote' ? 'upvoted' : 'downvoted'} your post`,
        link: `/post/${post.slug || post._id}`
      });
    }
    
    res.json({
      success: true,
      votes: post.votes,
      upvoteCount: upvoteCount,
      downvoteCount: downvoteCount,
      hasUpvoted: post.upvotes.some(id => id.toString() === userId),
      hasDownvoted: post.downvotes.some(id => id.toString() === userId),
      userVote: post.upvotes.some(id => id.toString() === userId) ? 'upvote' :
                post.downvotes.some(id => id.toString() === userId) ? 'downvote' : null,
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

// ====================
// PREVIEW LINK
// ====================

router.post('/preview-link', auth, async (req, res) => {
  const { url } = req.body;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const { result } = await ogs({
      url,
      timeout: 5000,
      followRedirect: true,
      headers: {
        'user-agent': 'Mozilla/5.0 (LinkPreviewBot)'
      }
    });

    if (!result.success) {
      return res.json({
        url: url,
        title: 'Link Preview',
        description: 'Click to visit this link',
        siteName: new URL(url).hostname,
        image: null,
        video: null
      });
    }

    res.json({
      title: result.ogTitle || result.twitterTitle || result.dcTitle || result.title || 'Link Preview',
      description: result.ogDescription || result.twitterDescription || result.dcDescription || result.description || 'Click to visit this link',
      image: result.ogImage?.url || result.twitterImage?.url || null,
      video: result.ogVideo?.url || null,
      siteName: result.ogSiteName || result.twitterSite || new URL(url).hostname,
      url
    });

  } catch (err) {
    console.error('Preview error for URL:', url, err);
    
    try {
      const urlObj = new URL(url);
      return res.json({
        url: url,
        title: 'External Link',
        description: 'This link will open in a new tab',
        siteName: urlObj.hostname,
        image: null,
        video: null
      });
    } catch (urlError) {
      return res.json({
        url: url,
        title: 'External Link',
        description: 'Click to visit this link',
        siteName: 'website',
        image: null,
        video: null
      });
    }
  }
});

// ====================
// STATIC ROUTES
// ====================

// GET /api/posts - Main posts route
router.get('/', async (req, res) => {
  try {
    const { 
      subreddit, 
      sort = 'new', 
      page = 1, 
      limit = 10,
      showAdult = 'false'
    } = req.query;
    
    let query = { isHidden: false };
    
    if (subreddit && subreddit.trim()) {
      query.subreddit = subreddit.toLowerCase().trim();
    }

    // Apply content filtering
    query = applyContentFilter(req, query);

    // Determine sort option
    let sortOption = {};
    if (sort === 'hot' || sort === 'top') {
      sortOption = { votes: -1, createdAt: -1 };
    } else if (sort === 'best') {
      sortOption = { votes: -1, createdAt: -1 };
    } else if (sort === 'new') {
      sortOption = { createdAt: -1 };
    } else {
      sortOption = { createdAt: -1 };
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Fetch posts with population
    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username karma')
      .lean();

    // Get user IDs for vote status if authenticated
    let userId = null;
    if (req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (tokenError) {
        // Token invalid, ignore user vote
      }
    }

    // Format posts for response
    const formattedPosts = posts.map(post => {
      // Check user vote if authenticated
      let userVote = null;
      if (userId) {
        userVote = post.upvotes?.some(id => id && id.toString() === userId) ? 'upvote' :
                   post.downvotes?.some(id => id && id.toString() === userId) ? 'downvote' : null;
      }
      
      return {
        _id: post._id,
        slug: post.slug,
        title: post.title || '',
        content: post.content || '',
        subreddit: post.subreddit || '',
        createdAt: post.createdAt || new Date(),
        authorId: post.author?._id,
        authorName: post.author?.username || 'deleted',
        authorKarma: post.author?.karma || 0,
        votes: post.votes || 0,
        commentCount: post.commentCount || 0,
        userVote: userVote,
        externalLink: post.externalLink || null,
        isAdult: post.isAdult || false,
        isHidden: post.isHidden || false
      };
    });

    // Get total count
    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      posts: formattedPosts,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total,
      sort: sort,
      showAdult: showAdult === 'true'
    });
    
  } catch (error) {
    console.error('GET /api/posts ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
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

// Get trending posts
router.get('/trending', async (req, res) => {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const posts = await Post.find({
      createdAt: { $gte: twoDaysAgo },
      isAdult: false
    })
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .limit(20);
    
    const postsWithScore = posts.map(post => {
      const hoursSinceCreated = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
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
    
    postsWithScore.sort((a, b) => b.trendingScore - a.trendingScore);
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

// Get user's posts
router.get('/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (!username || username.trim() === '') {
      return res.status(400).json({ 
        success: false,
        message: 'Username is required' 
      });
    }

    // 1. Find user
    const user = await User.findOne({ 
      username: username.trim() 
    }).select('_id username karma createdAt bio socialLinks');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // 2. Build query
    const query = { author: user._id, isHidden: false };
    
    // Apply content filtering
    const showAdult = req.query.showAdult === 'true';
    if (!showAdult) {
      query.isAdult = false;
    }

    // 3. Find posts with pagination
    const [posts, total] = await Promise.all([
      Post.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(query)
    ]);

    // 4. Format posts for response
    const formattedPosts = posts.map(post => {
      // Calculate votes
      const upvoteCount = post.upvotes ? post.upvotes.length : 0;
      const downvoteCount = post.downvotes ? post.downvotes.length : 0;
      const votes = post.votes || (upvoteCount - downvoteCount);
      
      return {
        _id: post._id,
        slug: post.slug,
        title: post.title || 'Untitled',
        content: post.content || '',
        subreddit: post.subreddit || 'general',
        createdAt: post.createdAt || new Date(),
        authorId: user._id,
        authorName: user.username,
        authorKarma: user.karma || 0,
        votes: votes,
        commentCount: post.commentCount || 0,
        externalLink: post.externalLink || null,
        isAdult: post.isAdult || false
      };
    });

    // 5. Prepare response
    const userInfo = {
      _id: user._id,
      username: user.username,
      karma: user.karma || 0,
      createdAt: user.createdAt,
      bio: user.bio || '',
      socialLinks: user.socialLinks || []
    };

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      user: userInfo,
      posts: formattedPosts,
      page: page,
      totalPages: totalPages,
      totalPosts: total,
      showAdult: showAdult
    });

  } catch (err) {
    console.error('GET /api/posts/user/:username ERROR:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// ====================
// POST CRUD OPERATIONS
// ====================

// Create post
router.post('/', auth, async (req, res) => {
  try {
    const { title, content = '', subreddit, isAdult = false } = req.body;

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

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid URL format' 
        });
      }

      // Try to fetch Open Graph data
      let result = {};
      try {
        const ogResponse = await ogs({ 
          url,
          timeout: 3000,
          followRedirect: true,
          headers: {
            'user-agent': 'Mozilla/5.0 (LinkPreviewBot)'
          }
        });
        result = ogResponse.result || {};
      } catch (err) {
        console.log('Open Graph fetch failed:', err.message);
        result = {};
      }

      externalLink = {
        url,
        platform: detectPlatform(url),
        title: result.ogTitle || result.twitterTitle || null,
        description: result.ogDescription || result.twitterDescription || null,
        image: result.ogImage?.url || result.twitterImage?.url || null,
        video: result.ogVideo?.url || null,
        siteName: result.ogSiteName || result.twitterSite || new URL(url).hostname
      };
    }

    // Generate initial slug
    const baseSlug = slugify(title.trim(), { lower: true, strict: true });
    let slug = baseSlug;
    const exists = await Post.findOne({ slug });
    if (exists) {
      slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;
    }

    const post = new Post({
      title: title.trim(),
      slug: slug,
      content: content.trim(),
      subreddit: subreddit.toLowerCase().trim(),
      author: req.user._id,
      authorName: req.user.username,
      externalLink,
      isAdult: Boolean(isAdult),
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
    
    // Handle duplicate slug error
    if (error.code === 11000 && error.keyPattern?.slug) {
      return res.status(400).json({
        success: false,
        error: 'Slug already exists. Please try a different title.'
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get single post by ID or slug
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Check for special routes
    if (['count', 'trending', 'subreddits', 'user', 'adult', 'public', 'search'].includes(identifier)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post identifier' 
      });
    }
    
    let post;
    
    // First, try to find by slug
    post = await Post.findOne({ slug: identifier })
      .populate('author', 'username karma bio socialLinks');
    
    // If not found by slug, try by ObjectId
    if (!post && mongoose.Types.ObjectId.isValid(identifier)) {
      post = await Post.findById(identifier)
        .populate('author', 'username karma bio socialLinks');
    }
    
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
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        
        userVote = post.upvotes?.some(id => id.toString() === userId) ? 'upvote' :
                   post.downvotes?.some(id => id.toString() === userId) ? 'downvote' : null;
      } catch (error) {
        // Token invalid or expired
      }
    }
    
    // Format the response
    const responsePost = post.toObject();
    responsePost.userVote = userVote;
    responsePost.votes = post.votes || 0;
    responsePost.commentCount = post.commentCount || 0;
    responsePost.authorName = post.author?.username;
    responsePost.isAdult = post.isAdult || false;
    
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

// ====================
// COMMENT ROUTES
// ====================

// Add comment
router.post('/:identifier/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const { identifier } = req.params;

    if (!content || !content.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Comment content is required' 
      });
    }

    // Find post by slug or ID
    let post;
    post = await Post.findOne({ slug: identifier });
    
    if (!post && mongoose.Types.ObjectId.isValid(identifier)) {
      post = await Post.findById(identifier);
    }
    
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
      post: post._id,
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
        post: post._id,
        comment: comment._id,
        message: `${req.user.username} commented on your post`,
        link: `/post/${post.slug || post._id}#comment-${comment._id}`
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

// Get comments for a post
router.get('/:identifier/comments', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { sort = 'best', limit = 100 } = req.query;

    // Find post by slug or ID
    let post;
    post = await Post.findOne({ slug: identifier });
    
    if (!post && mongoose.Types.ObjectId.isValid(identifier)) {
      post = await Post.findById(identifier);
    }
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
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
      post: post._id,
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

// ====================
// DELETE ROUTES
// ====================

// Delete post
router.delete('/:identifier', auth, async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Find post by slug or ID
    let post;
    post = await Post.findOne({ slug: identifier });
    
    if (!post && mongoose.Types.ObjectId.isValid(identifier)) {
      post = await Post.findById(identifier);
    }

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
    await Comment.deleteMany({ post: post._id });
    
    // Delete the post
    await Post.findByIdAndDelete(post._id);
    
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

module.exports = router;
