const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');

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
      authorKarma: post.author?.karma
    }));

    // Make sure headers aren't already sent
    if (!res.headersSent) {
      return res.json({ posts: normalizedPosts });
    }
    
  } catch (error) {
    console.error(error);
    // Only send error response if headers not sent
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Server error' });
    }
  }
});



    const total = await Post.countDocuments(query);

    res.json({ 
      posts,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalPosts: total
    });
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

// GET /api/posts/trending - Get trending posts
// MUST BE BEFORE THE /:id ROUTE!
router.get('/trending', async (req, res) => {
  try {
    // Get posts from the last 48 hours for trending
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const posts = await Post.find({
      createdAt: { $gte: twoDaysAgo }
    })
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .limit(20); // Get recent posts first
    
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

// Get single post - THIS MUST BE AFTER ALL OTHER SPECIFIC ROUTES!
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

// Add comment (NEW Comment model system)
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.id;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    // Verify post exists
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
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
// Delete comment (and its replies)
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Author-only delete
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
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

// Add these routes to your posts.js file

// Get comments for a post with nested replies
// Get comments for a post (top-level + replies)
router.get('/:id/comments', async (req, res) => {
  try {
    const { sort = 'best', limit = 100 } = req.query;

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
      post: req.params.id,
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

    // Find parent comment
    const parentComment = await Comment.findById(commentId);
    if (!parentComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Create reply
    const reply = new Comment({
      content,
      author: req.user._id,
      authorName: req.user.username,
      post: postId,
      parentComment: commentId,
      depth: parentComment.depth + 1
    });

    await reply.save();

    // Add reply to parent's replies array
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

    res.status(201).json({ success: true, comment: reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vote on comment
router.post('/comments/:commentId/vote', auth, async (req, res) => {
  try {
    const { type } = req.body; // 'upvote' or 'downvote'
    const { commentId } = req.params;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
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
    }

    await comment.save();

    res.json({ 
      success: true, 
      upvotes: comment.upvotes.length,
      downvotes: comment.downvotes.length,
      voteCount: comment.voteCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;