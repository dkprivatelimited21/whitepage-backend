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
      return res.status(404).json({ error: 'Post not found' });
    }

    // Remove existing votes
    const hasUpvoted = post.upvotedBy.includes(userId);
    const hasDownvoted = post.downvotedBy.includes(userId);

    if (type === 'upvote') {
      if (hasUpvoted) {
        // Remove upvote
        post.upvotedBy.pull(userId);
        post.votes -= 1;
      } else {
        // Add upvote
        if (hasDownvoted) {
          post.downvotedBy.pull(userId);
          post.votes += 2; // Remove downvote and add upvote
        } else {
          post.votes += 1;
        }
        post.upvotedBy.push(userId);
      }
    } else if (type === 'downvote') {
      if (hasDownvoted) {
        // Remove downvote
        post.downvotedBy.pull(userId);
        post.votes += 1;
      } else {
        // Add downvote
        if (hasUpvoted) {
          post.upvotedBy.pull(userId);
          post.votes -= 2; // Remove upvote and add downvote
        } else {
          post.votes -= 1;
        }
        post.downvotedBy.push(userId);
      }
    }

    await post.save();
    res.json({ votes: post.votes, hasUpvoted, hasDownvoted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;