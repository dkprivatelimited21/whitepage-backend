// routes/comments.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Comment = require('../models/Comment');
const Post = require('../models/Post');

// Get comments for a post
router.get('/:postId/comments', async (req, res) => {
  try {
    const { sort = 'best', limit = 50, page = 1 } = req.query;
    const postId = req.params.postId;
    
    // Verify post exists
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // Build sort query
    let sortOption = {};
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

    // Fetch top-level comments (no parentComment)
    const comments = await Comment.find({ 
      post: postId,
      parentComment:  null // Only top-level comments
    })
    .sort(sortOption)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .populate('author', 'username avatar')
    .populate({
      path: 'replies',
      populate: { path: 'author', select: 'username avatar' }
    });

const totalComments = await Comment.countDocuments({ 
  post: postId,
  parentComment: null
});

   const normalizedComments = comments.map(comment => ({
  ...comment.toObject(),
  authorName: comment.author?.username || '[deleted]',
  replies: (comment.replies || []).map(reply => ({
    ...reply.toObject(),
    authorName: reply.author?.username || '[deleted]'
  }))
}));

res.json({
  success: true,
  comments: normalizedComments,
  total: totalComments,
  page: parseInt(page),
  totalPages: Math.ceil(totalComments / parseInt(limit))
});

  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch comments' });
  }
});

// Add a comment to a post
router.post('/:postId/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.postId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Comment content is required' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const comment = new Comment({
      content: content.trim(),
      author: req.user._id,
      post: postId,
      authorName: req.user.username
    });

    await comment.save();

    // Increment post comment count
    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'username avatar');

    res.status(201).json({
      success: true,
      comment: populatedComment
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ success: false, error: 'Failed to create comment' });
  }
});

module.exports = router;