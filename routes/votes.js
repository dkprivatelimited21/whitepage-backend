// routes/votes.js - UPDATED
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Post = require('../models/Post');

// Vote on post
router.post('/:postId/:type', auth, async (req, res) => {
  try {
    const { postId, type } = req.params;
    const userId = req.user._id;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ 
        success: false, 
        error: 'Post not found' 
      });
    }

    // Initialize arrays if they don't exist
    post.upvotes = post.upvotes || [];
    post.downvotes = post.downvotes || [];

    // Check current vote status
    const hasUpvoted = post.upvotes.some(id => id.toString() === userId.toString());
    const hasDownvoted = post.downvotes.some(id => id.toString() === userId.toString());

    // If clicking the same vote type again, remove the vote (toggle)
    if ((type === 'upvote' && hasUpvoted) || (type === 'downvote' && hasDownvoted)) {
      // Remove the vote
      post.upvotes = post.upvotes.filter(id => id.toString() !== userId.toString());
      post.downvotes = post.downvotes.filter(id => id.toString() !== userId.toString());
    } else {
      // Remove opposite vote if exists
      if (type === 'upvote' && hasDownvoted) {
        post.downvotes = post.downvotes.filter(id => id.toString() !== userId.toString());
      } else if (type === 'downvote' && hasUpvoted) {
        post.upvotes = post.upvotes.filter(id => id.toString() !== userId.toString());
      }
      
      // Add new vote
      if (type === 'upvote') {
        post.upvotes.push(userId);
      } else {
        post.downvotes.push(userId);
      }
    }

    // Calculate total votes
    const votes = post.upvotes.length - post.downvotes.length;
    post.votes = votes;

    await post.save();

    res.json({
      success: true,
      votes: votes,
      hasUpvoted: post.upvotes.some(id => id.toString() === userId.toString()),
      hasDownvoted: post.downvotes.some(id => id.toString() === userId.toString())
    });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Add this route to votes.js (after the post vote route)
const Comment = require('../models/Comment'); // Add this at the top

// Vote on comment
router.post('/comments/:commentId/:type', auth, async (req, res) => {
  try {
    const { commentId, type } = req.params;
    const userId = req.user._id;
    const comment = await Comment.findById(commentId);

    if (!comment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Comment not found' 
      });
    }

    // Initialize arrays if they don't exist
    comment.upvotes = comment.upvotes || [];
    comment.downvotes = comment.downvotes || [];

    // Check current vote status
    const hasUpvoted = comment.upvotes.some(id => id.toString() === userId.toString());
    const hasDownvoted = comment.downvotes.some(id => id.toString() === userId.toString());

    // If clicking the same vote type again, remove the vote (toggle)
    if ((type === 'upvote' && hasUpvoted) || (type === 'downvote' && hasDownvoted)) {
      // Remove the vote
      comment.upvotes = comment.upvotes.filter(id => id.toString() !== userId.toString());
      comment.downvotes = comment.downvotes.filter(id => id.toString() !== userId.toString());
    } else {
      // Remove opposite vote if exists
      if (type === 'upvote' && hasDownvoted) {
        comment.downvotes = comment.downvotes.filter(id => id.toString() !== userId.toString());
      } else if (type === 'downvote' && hasUpvoted) {
        comment.upvotes = comment.upvotes.filter(id => id.toString() !== userId.toString());
      }
      
      // Add new vote
      if (type === 'upvote') {
        comment.upvotes.push(userId);
      } else {
        comment.downvotes.push(userId);
      }
    }

    await comment.save();

    res.json({
      success: true,
      upvotes: comment.upvotes.length,
      downvotes: comment.downvotes.length,
      voteCount: comment.voteCount
    });
  } catch (error) {
    console.error('Comment vote error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


module.exports = router;