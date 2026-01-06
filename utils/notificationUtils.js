// utils/notificationUtils.js
const Notification = require('../models/Notification');

class NotificationService {
  // Create a notification
  static async createNotification(data) {
    try {
      // Check for duplicate notification within last 24 hours
      const existingNotification = await Notification.findOne({
        user: data.user,
        type: data.type,
        sender: data.sender,
        post: data.post,
        comment: data.comment,
        createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      });

      if (existingNotification) {
        console.log('Duplicate notification prevented');
        return null;
      }

      const notification = new Notification(data);
      await notification.save();
      
      // Populate sender info for immediate use
      const populated = await Notification.findById(notification._id)
        .populate('sender', 'username avatar')
        .populate('post', 'title')
        .populate('comment', 'content');
      
      return populated;
    } catch (error) {
      console.error('Error creating notification:', error);
      return null;
    }
  }

  // Create vote notification
  static async createVoteNotification(voteData) {
    const { voterId, voterName, recipientId, type, postId, commentId, postTitle, commentContent } = voteData;
    
    // Don't notify if voting on own content
    if (voterId.toString() === recipientId.toString()) {
      return null;
    }

    const notificationData = {
      user: recipientId,
      type: type, // 'upvote' or 'downvote'
      sender: voterId,
      senderName: voterName,
      post: postId,
      comment: commentId || null,
      postTitle: postTitle || null,
      commentContent: commentContent || null,
      message: `${voterName} ${type}d your ${commentId ? 'comment' : 'post'}`
    };

    return await this.createNotification(notificationData);
  }

  // Create reply notification
  static async createReplyNotification(replyData) {
    const { commenterId, commenterName, recipientId, type, postId, commentId, postTitle, commentContent } = replyData;
    
    // Don't notify if replying to self
    if (commenterId.toString() === recipientId.toString()) {
      return null;
    }

    const notificationData = {
      user: recipientId,
      type: type, // 'post_reply' or 'comment_reply'
      sender: commenterId,
      senderName: commenterName,
      post: postId,
      comment: commentId || null,
      postTitle: postTitle || null,
      commentContent: commentContent || null,
      message: `${commenterName} ${type === 'post_reply' ? 'commented on your post' : 'replied to your comment'}`
    };

    return await this.createNotification(notificationData);
  }

  // Create follower notification
  static async createFollowerNotification(followerId, followerName, followingId) {
    const notificationData = {
      user: followingId,
      type: 'new_follower',
      sender: followerId,
      senderName: followerName,
      message: `${followerName} started following you`
    };

    return await this.createNotification(notificationData);
  }

  // Get notifications for a user (for real-time updates)
  static async getUserNotifications(userId, limit = 10) {
    return await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'username avatar')
      .populate('post', 'title')
      .lean();
  }
}

module.exports = NotificationService;