// routes/notifications.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

// Get user notifications with better filtering
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 20, page = 1, type } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = { user: req.user._id };
    if (type) {
      query.type = type;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('sender', 'username avatar')
      .populate('post', 'title')
      .populate('comment', 'content')
      .lean(); // Use lean for better performance

    // Format notifications for frontend
    const formattedNotifications = notifications.map(notification => ({
      _id: notification._id,
      type: notification.type,
      senderId: notification.sender?._id,
      senderName: notification.senderName || notification.sender?.username,
      postId: notification.post?._id,
      commentId: notification.comment?._id,
      message: notification.message || getDefaultMessage(notification),
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      postTitle: notification.postTitle || notification.post?.title,
      commentContent: notification.commentContent || notification.comment?.content
    }));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ 
      user: req.user._id, 
      isRead: false 
    });

    res.json({
      success: true,
      notifications: formattedNotifications,
      unreadCount,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalNotifications: total
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

// Helper function for default messages
function getDefaultMessage(notification) {
  switch (notification.type) {
    case 'upvote':
      if (notification.comment) {
        return `${notification.sender?.username || 'Someone'} upvoted your comment`;
      }
      return `${notification.sender?.username || 'Someone'} upvoted your post`;
    case 'downvote':
      if (notification.comment) {
        return `${notification.sender?.username || 'Someone'} downvoted your comment`;
      }
      return `${notification.sender?.username || 'Someone'} downvoted your post`;
    case 'comment_reply':
      return `${notification.sender?.username || 'Someone'} replied to your comment`;
    case 'post_reply':
      return `${notification.sender?.username || 'Someone'} commented on your post`;
    case 'new_follower':
      return `${notification.sender?.username || 'Someone'} started following you`;
    default:
      return 'New notification';
  }
}

// Get unread notifications count ONLY
router.get('/unread-count', auth, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ 
      user: req.user._id, 
      isRead: false 
    });
    
    res.json({ success: true, count: unreadCount });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch unread count' });
  }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark all notifications as read
router.post('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all notifications (optional)
router.delete('/', auth, async (req, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });
    res.json({ success: true, message: 'All notifications cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;