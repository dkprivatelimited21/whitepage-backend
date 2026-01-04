const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Post = require('../models/Post');

// Get all posts (with optional subreddit filter)
router.get('/', async (req, res) => {
  try {
    const { subreddit, sort = 'new' } = req.query;
    let query = {};
    
    if (subreddit) {
      query.subreddit = subreddit.toLowerCase();
    }

    let sortOption = {};
    if (sort === 'hot') {
      sortOption = { votes: -1 };
    } else if (sort === 'top') {
      sortOption = { votes: -1 };
    } else {
      sortOption = { createdAt: -1 }; // new
    }

    const posts = await Post.find(query)
      .sort(sortOption)
      .limit(50)
      .populate('author', 'username karma');

    res.json({ posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    res.json({ subreddits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create post
router.post('/', auth, async (req, res) => {
  try {
    const { title, content, subreddit } = req.body;

    const post = new Post({
      title,
      content,
      subreddit: subreddit.toLowerCase(),
      author: req.user._id,
      authorName: req.user.username
    });

    await post.save();
    res.status(201).json({ post });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single post
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username karma');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ post });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.comments.push({
      author: req.user._id,
      authorName: req.user.username,
      content
    });

    post.commentCount += 1;
    await post.save();

    res.status(201).json({ comments: post.comments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete post
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete comment
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Find the comment
    const commentIndex = post.comments.findIndex(
      comment => comment._id.toString() === commentId
    );

    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = post.comments[commentIndex];

    // Check if user is the author of the comment
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    // Remove the comment
    post.comments.splice(commentIndex, 1);
    post.commentCount -= 1;
    await post.save();

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get posts by user
router.get('/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const posts = await Post.find({ authorName: username })
      .sort({ createdAt: -1 })
      .populate('author', 'username')
      .limit(50);

    res.json({ posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/posts/trending - Get trending posts
router.get('/trending', async (req, res) => {
  try {
    const trendingPosts = await Post.find()
      .populate('author', 'username')
      .populate('community', 'name')
      .sort({ 
        // Sort by a combination of upvotes, comments, and recency
        // You can adjust these weights based on your preference
        // score = (upvotes * 2) + comments + (hoursSinceCreated * -0.1)
      })
      .limit(5); // Limit to 5 trending posts
    
    // Alternative: Calculate trending score
    const posts = await Post.find()
      .populate('author', 'username')
      .populate('community', 'name')
      .sort({ createdAt: -1 })
      .limit(20); // Get recent posts first
    
    // Calculate trending score for each post
    const postsWithScore = posts.map(post => {
      const hoursSinceCreated = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
      const score = post.upvotes.length * 2 + (post.comments?.length || 0) - hoursSinceCreated * 0.1;
      
      return {
        ...post.toObject(),
        trendingScore: score
      };
    });
    
    // Sort by trending score
    postsWithScore.sort((a, b) => b.trendingScore - a.trendingScore);
    
    // Take top 5
    const trendingPosts = postsWithScore.slice(0, 5);
    
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

// Alternative simpler trending algorithm
router.get('/trending/simple', async (req, res) => {
  try {
    const trendingPosts = await Post.find()
      .populate('author', 'username')
      .populate('community', 'name')
      .sort({ 
        // Sort by upvotes first, then comments, then recency
        upvotes: -1,
        comments: -1,
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

// GET /api/posts - Get all posts with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const posts = await Post.find()
      .populate('author', 'username')
      .populate('community', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Post.countDocuments();
    
    res.json({
      success: true,
      posts: posts,
      page: page,
      totalPages: Math.ceil(total / limit),
      totalPosts: total
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts'
    });
  }
});




module.exports = router;