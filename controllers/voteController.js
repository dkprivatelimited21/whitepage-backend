const NotificationService = require('../utils/notificationUtils');

// After successful vote
const createVoteNotification = async (req, voteType, postId, commentId = null) => {
  try {
    // Get post/comment details
    const post = await Post.findById(postId).select('author title');
    const comment = commentId ? await Comment.findById(commentId).select('author content') : null;
    
    const recipientId = comment ? comment.author : post.author;
    
    // Only create notification if recipient is not the voter
    if (recipientId.toString() !== req.user._id.toString()) {
      await NotificationService.createVoteNotification({
        voterId: req.user._id,
        voterName: req.user.username,
        recipientId: recipientId,
        type: voteType,
        postId: postId,
        commentId: commentId,
        postTitle: post.title,
        commentContent: comment ? comment.content.substring(0, 200) : null
      });
    }
  } catch (error) {
    console.error('Error creating vote notification:', error);
    // Don't fail the vote if notification fails
  }
};