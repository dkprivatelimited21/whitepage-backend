const NotificationService = require('../utils/notificationUtils');

// After creating a comment/reply
const createReplyNotification = async (req, postId, parentCommentId = null, commentId) => {
  try {
    const post = await Post.findById(postId).select('author title');
    const parentComment = parentCommentId ? 
      await Comment.findById(parentCommentId).select('author content') : null;
    
    // Determine recipient and notification type
    let recipientId, notificationType;
    
    if (parentCommentId) {
      // Replying to a comment
      recipientId = parentComment.author;
      notificationType = 'comment_reply';
    } else {
      // Commenting on a post
      recipientId = post.author;
      notificationType = 'post_reply';
    }
    
    // Only create notification if recipient is not the commenter
    if (recipientId.toString() !== req.user._id.toString()) {
      await NotificationService.createReplyNotification({
        commenterId: req.user._id,
        commenterName: req.user.username,
        recipientId: recipientId,
        type: notificationType,
        postId: postId,
        commentId: commentId,
        postTitle: post.title,
        commentContent: req.body.content.substring(0, 200)
      });
    }
  } catch (error) {
    console.error('Error creating reply notification:', error);
    // Don't fail the comment if notification fails
  }
};