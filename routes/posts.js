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

module.exports = router;