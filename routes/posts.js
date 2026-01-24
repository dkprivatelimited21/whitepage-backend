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
// CONTENT FILTERING MIDDLEWARE
// ====================

const applyContentFilter = (req, query) => {
  const showAdult = req.query.showAdult === 'true';
  const user = req.user;
  
  // Default: hide adult content
  if (!showAdult) {
    query.isAdult = false;
  }
  
  // For authenticated users, check their preference
  if (user && user.settings) {
    const userPref = user.settings.showAdultContent || false;
    if (!userPref) {
      query.isAdult = false;
    }
  }
  
  // For guest users (public feed), always hide adult content
  if (!user && req.query.public === 'true') {
    query.isAdult = false;
  }
  
  return query;
};

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

// GET /api/posts - Main posts route with content filtering
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/posts called with query:', req.query);
    
    const { 
      subreddit, 
      sort = 'new', 
      page = 1, 
      limit = 10,
      showAdult = 'false',
      public = 'false'
    } = req.query;
    
    let query = {};
    
    if (subreddit && subreddit.trim()) {
      query.subreddit = subreddit.toLowerCase().trim();
    }

    // Apply content filtering
    query = applyContentFilter(req, query);
    
    // For public feed, ensure no adult content
    if (public === 'true') {
      query.isAdult = false;
    }

    // Log the query for debugging
    console.log('Database query:', query);
    console.log('Sort parameter:', sort);

    // Determine sort option
    let sortOption = {};
    if (sort === 'hot' || sort === 'top') {
      sortOption = { votes: -1, createdAt: -1 };
    } else if (sort === 'best') {
      sortOption = { votes: -1, createdAt: -1 };
    } else if (sort === 'new') {
      sortOption = { createdAt: -1 };
    } else {
      // Default to newest if sort is invalid
      sortOption = { createdAt: -1 };
    }

    console.log('Sort option:', sortOption);

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    console.log(`Fetching posts: page=${pageNum}, limit=${limitNum}, skip=${skip}`);

    // Basic query without populate to see if it works
    let posts;
    try {
      posts = await Post.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean();
      
      console.log(`Found ${posts.length} posts`);
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Database query failed',
        details: dbError.message
      });
    }

    // Get user IDs for population
    const authorIds = posts.map(post => post.author).filter(id => id);
    
    // Fetch authors separately if needed
    let authors = {};
    if (authorIds.length > 0) {
      try {
        const authorDocs = await User.find({ _id: { $in: authorIds } })
          .select('username karma')
          .lean();
        
        authorDocs.forEach(author => {
          authors[author._id] = author;
        });
      } catch (authorError) {
        console.error('Error fetching authors:', authorError);
        // Continue without author info rather than failing
      }
    }

    // Format posts for response
    const formattedPosts = posts.map(post => {
      const author = authors[post.author] || { username: 'deleted', karma: 0 };
      
      // Check user vote if authenticated
      let userVote = null;
      if (req.headers.authorization) {
        try {
          const token = req.headers.authorization.split(' ')[1];
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const userId = decoded.userId;
          
          const upvotes = post.upvotes || [];
          const downvotes = post.downvotes || [];
          
          userVote = upvotes.some(id => id.toString() === userId) ? 'upvote' :
                    downvotes.some(id => id.toString() === userId) ? 'downvote' : null;
        } catch (tokenError) {
          // Token invalid, ignore user vote
        }
      }
      
      return {
        _id: post._id,
        title: post.title || '',
        content: post.content || '',
        subreddit: post.subreddit || '',
        createdAt: post.createdAt || new Date(),
        authorId: post.author,
        authorName: author.username,
        authorKarma: author.karma || 0,
        votes: post.votes || 0,
        commentCount: post.commentCount || 0,
        userVote: userVote,
        externalLink: post.externalLink || null,
        isAdult: post.isAdult || false, // Include adult flag
        isHidden: post.isHidden || false
      };
    });

    // Get total count
    let total = 0;
    try {
      total = await Post.countDocuments(query);
    } catch (countError) {
      console.error('Count error:', countError);
      total = posts.length; // Fallback to current page count
    }

    console.log('Response prepared successfully');

    res.json({
      success: true,
      posts: formattedPosts,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total,
      sort: sort,
      showAdult: showAdult === 'true',
      isPublicFeed: public === 'true'
    });
    
  } catch (error) {
    console.error('GET /api/posts ERROR:', error);
    console.error('Error stack:', error.stack);
    
    // Send more detailed error for debugging
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Add new route for public feed (no adult content)
router.get('/public/feed', async (req, res) => {
  try {
    const { 
      sort = 'new', 
      page = 1, 
      limit = 10 
    } = req.query;
    
    let query = {
      isAdult: false, // Always exclude adult content
      isHidden: false
    };
    
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

    // Fetch posts
    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username karma')
      .lean();

    // Get total count
    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      posts: posts.map(post => ({
        _id: post._id,
        title: post.title || '',
        content: post.content || '',
        subreddit: post.subreddit || '',
        createdAt: post.createdAt || new Date(),
        authorName: post.author?.username || 'deleted',
        authorKarma: post.author?.karma || 0,
        votes: post.votes || 0,
        commentCount: post.commentCount || 0,
        isAdult: false, // Always false for public feed
        externalLink: post.externalLink || null
      })),
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total,
      sort: sort,
      isPublicFeed: true
    });
    
  } catch (error) {
    console.error('GET /api/posts/public/feed ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add route to get adult content separately
router.get('/adult', auth, async (req, res) => {
  try {
    // Check if user is allowed to view adult content
    const user = await User.findById(req.user._id);
    
    if (!user.settings?.showAdultContent) {
      return res.status(403).json({
        success: false,
        error: 'Adult content viewing is disabled in your settings'
      });
    }
    
    const { 
      sort = 'new', 
      page = 1, 
      limit = 10 
    } = req.query;
    
    let query = {
      isAdult: true,
      isHidden: false
    };
    
    // Determine sort option
    let sortOption = {};
    if (sort === 'new') {
      sortOption = { createdAt: -1 };
    } else if (sort === 'top') {
      sortOption = { votes: -1 };
    } else {
      sortOption = { createdAt: -1 };
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Fetch adult posts
    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate('author', 'username karma')
      .lean();

    // Get total count
    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      posts: posts.map(post => ({
        _id: post._id,
        title: post.title || '',
        content: post.content || '',
        subreddit: post.subreddit || '',
        createdAt: post.createdAt || new Date(),
        authorName: post.author?.username || 'deleted',
        authorKarma: post.author?.karma || 0,
        votes: post.votes || 0,
        commentCount: post.commentCount || 0,
        isAdult: true,
        externalLink: post.externalLink || null
      })),
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total,
      sort: sort,
      warning: 'Adult Content - 18+ only'
    });
    
  } catch (error) {
    console.error('GET /api/posts/adult ERROR:', error);
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

// GET /api/posts/trending - Get trending posts
router.get('/trending', async (req, res) => {
  try {
    // Get posts from the last 48 hours for trending
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const posts = await Post.find({
      createdAt: { $gte: twoDaysAgo },
      isAdult: false // Exclude adult content from trending
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
      createdAt: { $gte: oneWeekAgo },
      isAdult: false // Exclude adult content
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

// ====================
// GET USER'S POSTS WITH PROFILE INFO - UPDATED VERSION
// ====================
router.get('/user/:username', async (req, res) => {
  try {
    console.log('GET /api/posts/user/:username called for:', req.params.username);
    
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

    console.log(`Looking for user: ${username}`);

    // 1. Find user
    const user = await User.findOne({ 
      username: username.trim() 
    }).select('_id username karma createdAt bio socialLinks');
    
    if (!user) {
      console.log(`User not found: ${username}`);
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    console.log(`Found user: ${user.username} (ID: ${user._id})`);

    // 2. Build query to find user's posts
    const query = { author: user._id };
    
    // Apply content filtering for user posts
    const showAdult = req.query.showAdult === 'true';
    if (!showAdult) {
      query.isAdult = false;
    }
    
    console.log('Query for posts:', query);

    // 3. Find posts with pagination
    let posts = [];
    let total = 0;
    
    try {
      [posts, total] = await Promise.all([
        Post.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(), // Use lean() for better performance
        Post.countDocuments(query)
      ]);
      
      console.log(`Found ${posts.length} posts out of ${total} total`);
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch posts',
        error: dbError.message
      });
    }

    // 4. Format posts for response
    const formattedPosts = posts.map(post => {
      console.log('Processing post:', post._id, 'Title:', post.title);
      
      // Get user vote status if authenticated
      let userVote = null;
      if (req.headers.authorization) {
        try {
          const token = req.headers.authorization.split(' ')[1];
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const userId = decoded.userId;
          
          const upvotes = post.upvotes || [];
          const downvotes = post.downvotes || [];
          
          userVote = upvotes.some(id => id && id.toString() === userId) ? 'upvote' :
                    downvotes.some(id => id && id.toString() === userId) ? 'downvote' : null;
        } catch (tokenError) {
          // Token invalid or expired
        }
      }
      
      // Calculate votes if not already calculated
      const upvoteCount = post.upvotes ? post.upvotes.length : 0;
      const downvoteCount = post.downvotes ? post.downvotes.length : 0;
      const votes = post.votes || (upvoteCount - downvoteCount);
      
      return {
        _id: post._id,
        title: post.title || 'Untitled',
        content: post.content || '',
        subreddit: post.subreddit || 'general',
        createdAt: post.createdAt || new Date(),
        authorId: user._id,
        authorName: user.username,
        authorKarma: user.karma || 0,
        votes: votes,
        commentCount: post.commentCount || 0,
        userVote: userVote,
        externalLink: post.externalLink || null,
        isAdult: post.isAdult || false
      };
    });

    // 5. Prepare user info
    const userInfo = {
      _id: user._id,
      username: user.username,
      karma: user.karma || 0,
      createdAt: user.createdAt,
      bio: user.bio || '',
      socialLinks: user.socialLinks || []
    };

    // 6. Calculate total pages
    const totalPages = Math.ceil(total / limit);

    console.log('Sending response with', formattedPosts.length, 'posts');

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
    console.error('Error stack:', err.stack);
    
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Add this search route in posts.js (add it after the other static routes, before the dynamic routes)

/* ---------------------------------------------------
   SEARCH POSTS, COMMUNITIES, USERS
   This is the primary search endpoint for your Header.jsx
--------------------------------------------------- */
router.get('/search', async (req, res) => {
  try {
    const { q: query, type = 'all', page = 1, limit = 10 } = req.query;
    
    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchQuery = query.trim().toLowerCase();
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log(`Searching for: "${searchQuery}", type: ${type}, page: ${pageNum}, limit: ${limitNum}`);

    let results = {
      posts: [],
      communities: [],
      users: []
    };

    let totalResults = 0;

    // Search posts
    if (type === 'all' || type === 'posts') {
      const postQuery = {
        $or: [
          { title: { $regex: searchQuery, $options: 'i' } },
          { content: { $regex: searchQuery, $options: 'i' } },
          { subreddit: { $regex: searchQuery, $options: 'i' } }
        ],
        isAdult: false // Exclude adult content from search by default
      };

      try {
        const [posts, postCount] = await Promise.all([
          Post.find(postQuery)
            .sort({ createdAt: -1 })
            .skip(type === 'posts' ? skip : 0)
            .limit(type === 'posts' ? limitNum : 5)
            .populate('author', 'username')
            .lean(),
          type === 'posts' ? Post.countDocuments(postQuery) : Promise.resolve(0)
        ]);

        results.posts = posts.map(post => {
          const upvoteCount = post.upvotes?.length || 0;
          const downvoteCount = post.downvotes?.length || 0;
          
          return {
            _id: post._id,
            title: post.title,
            content: post.content?.substring(0, 200) + (post.content?.length > 200 ? '...' : ''),
            subreddit: post.subreddit,
            author: post.author,
            authorName: post.author?.username,
            votes: upvoteCount - downvoteCount,
            commentCount: post.commentCount || 0,
            createdAt: post.createdAt,
            type: 'post',
            highlight: 'Post',
            isAdult: post.isAdult || false
          };
        });

        if (type === 'posts') {
          totalResults = postCount;
        }
      } catch (error) {
        console.error('Error searching posts:', error);
        results.posts = [];
      }
    }

    // Search communities (if you have Community model)
    if (type === 'all' || type === 'communities') {
      try {
        const Community = require('../models/Community');
        const communityQuery = {
          $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { displayName: { $regex: searchQuery, $options: 'i' } },
            { description: { $regex: searchQuery, $options: 'i' } }
          ]
        };

        const communities = await Community.find(communityQuery)
          .sort({ memberCount: -1 })
          .skip(type === 'communities' ? skip : 0)
          .limit(type === 'communities' ? limitNum : 5)
          .lean();

        results.communities = communities.map(community => ({
          _id: community._id,
          name: community.name,
          displayName: community.displayName,
          description: community.description,
          memberCount: community.memberCount || 0,
          createdAt: community.createdAt,
          type: 'community',
          highlight: 'Community'
        }));

        if (type === 'communities') {
          totalResults = await Community.countDocuments(communityQuery);
        }
      } catch (error) {
        console.error('Error searching communities:', error);
        // If Community model doesn't exist, return empty array
        results.communities = [];
      }
    }

    // Search users
    if (type === 'all' || type === 'users') {
      const userQuery = {
        username: { $regex: searchQuery, $options: 'i' }
      };

      try {
        const User = require('../models/User');
        const [users, userCount] = await Promise.all([
          User.find(userQuery)
            .select('username karma createdAt bio')
            .sort({ karma: -1 })
            .skip(type === 'users' ? skip : 0)
            .limit(type === 'users' ? limitNum : 5)
            .lean(),
          type === 'users' ? User.countDocuments(userQuery) : Promise.resolve(0)
        ]);

        results.users = users.map(user => ({
          _id: user._id,
          username: user.username,
          karma: user.karma || 0,
          createdAt: user.createdAt,
          bio: user.bio,
          type: 'user',
          highlight: 'User'
        }));

        if (type === 'users') {
          totalResults = userCount;
        }
      } catch (error) {
        console.error('Error searching users:', error);
        results.users = [];
      }
    }

    // If type is 'all', combine and sort by relevance
    if (type === 'all') {
      const allResults = [
        ...results.posts,
        ...results.communities,
        ...results.users
      ];

      // Sort by relevance (you can adjust this algorithm)
      allResults.sort((a, b) => {
        // Give higher priority to exact matches
        const aScore = getRelevanceScore(a, searchQuery);
        const bScore = getRelevanceScore(b, searchQuery);
        return bScore - aScore;
      });

      // Take top results for all search
      results.all = allResults.slice(0, 10);
    }

    res.json({
      success: true,
      query: searchQuery,
      results: results,
      totalResults: totalResults,
      page: type !== 'all' ? pageNum : 1,
      totalPages: type !== 'all' ? Math.ceil(totalResults / limitNum) : 1,
      type: type
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed. Please try again.'
    });
  }
});

// Helper function for relevance scoring
function getRelevanceScore(item, query) {
  let score = 0;
  const queryWords = query.toLowerCase().split(' ');
  
  // Check for exact match in title/name
  if (item.title && item.title.toLowerCase().includes(query)) {
    score += 100;
  }
  if (item.name && item.name.toLowerCase().includes(query)) {
    score += 100;
  }
  if (item.username && item.username.toLowerCase().includes(query)) {
    score += 100;
  }
  
  // Check for partial matches
  queryWords.forEach(word => {
    if (item.title && item.title.toLowerCase().includes(word)) {
      score += 10;
    }
    if (item.name && item.name.toLowerCase().includes(word)) {
      score += 10;
    }
    if (item.username && item.username.toLowerCase().includes(word)) {
      score += 10;
    }
    if (item.content && item.content.toLowerCase().includes(word)) {
      score += 5;
    }
    if (item.description && item.description.toLowerCase().includes(word)) {
      score += 5;
    }
  });
  
  // Recent items get higher score
  if (item.createdAt) {
    const daysOld = (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 7) score += 20;
    else if (daysOld < 30) score += 10;
  }
  
  // Popular items get higher score
  if (item.votes > 0) score += item.votes;
  if (item.memberCount > 0) score += item.memberCount;
  if (item.karma > 0) score += item.karma;
  
  return score;
}

/* ---------------------------------------------------
   SIMPLIFIED SEARCH FOR HEADER AUTOCOMPLETE
--------------------------------------------------- */
router.get('/search/autocomplete', async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query || query.trim() === '' || query.length < 2) {
      return res.json({
        success: true,
        posts: [],
        communities: [],
        users: []
      });
    }

    const searchQuery = query.trim().toLowerCase();
    
    const results = {
      posts: [],
      communities: [],
      users: []
    };

    // Search posts (titles only for autocomplete)
    const posts = await Post.find({
      title: { $regex: searchQuery, $options: 'i' },
      isAdult: false // Exclude adult content from autocomplete
    })
    .select('title subreddit createdAt votes commentCount isAdult')
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

    results.posts = posts.map(post => ({
      _id: post._id,
      title: post.title,
      subreddit: post.subreddit,
      type: 'post',
      isAdult: post.isAdult || false
    }));

    // Search communities
    try {
      const Community = require('../models/Community');
      const communities = await Community.find({
        $or: [
          { name: { $regex: searchQuery, $options: 'i' } },
          { displayName: { $regex: searchQuery, $options: 'i' } }
        ]
      })
      .select('name displayName memberCount')
      .sort({ memberCount: -1 })
      .limit(2)
      .lean();

      results.communities = communities.map(community => ({
        _id: community._id,
        name: community.name,
        displayName: community.displayName,
        memberCount: community.memberCount || 0,
        type: 'community'
      }));
    } catch (error) {
      // Community model not available
    }

    // Search users
    try {
      const User = require('../models/User');
      const users = await User.find({
        username: { $regex: searchQuery, $options: 'i' }
      })
      .select('username karma')
      .sort({ karma: -1 })
      .limit(2)
      .lean();

      results.users = users.map(user => ({
        _id: user._id,
        username: user.username,
        karma: user.karma || 0,
        type: 'user'
      }));
    } catch (error) {
      console.error('Error searching users:', error);
    }

    res.json({
      success: true,
      query: searchQuery,
      results: results
    });

  } catch (error) {
    console.error('Autocomplete search error:', error);
    res.json({
      success: false,
      posts: [],
      communities: [],
      users: []
    });
  }
});

// ====================
// DYNAMIC ROUTES (/:id) - MUST BE AFTER ALL STATIC ROUTES
// ====================

// Create post
router.post('/', auth, async (req, res) => {
  try {
    const { title, content = '', subreddit, isAdult = false } = req.body;

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
      isAdult: Boolean(isAdult), // Add adult content flag
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
    if (id === 'count' || id === 'trending' || id === 'subreddits' || id === 'user' || 
        id === 'adult' || id === 'public' || id === 'search') {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid post ID' 
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      // Try to find by slug
      const postBySlug = await Post.findOne({ slug: id })
        .populate('author', 'username karma bio socialLinks');
      
      if (postBySlug) {
        return handlePostResponse(req, res, postBySlug);
      }
      
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

    return handlePostResponse(req, res, post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Helper function for post response
const handlePostResponse = async (req, res, post) => {
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
  responsePost.isAdult = post.isAdult || false;

  res.json({ 
    success: true,
    post: responsePost
  });
};

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