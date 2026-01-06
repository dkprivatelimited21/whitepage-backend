const express = require('express');
const router = express.Router();
const Community = require('../models/Community');
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const mongoose = require('mongoose');

// GET /api/communities - Get all communities
router.get('/', async (req, res) => {
  try {
    const communities = await Community.find()
      .select('name displayName description memberCount createdAt isPublic isNSFW bannerColor')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      communities: communities
    });
  } catch (error) {
    console.error('Error fetching communities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch communities'
    });
  }
});

// Check if community exists (FIXED)
router.get('/check/:name', async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    // Return available = true if community doesn't exist (name is free)
    if (!community) {
      return res.json({
        success: true,
        available: true,
        message: 'Name is available'
      });
    }
    
    // If community exists, name is not available
    res.json({
      success: true,
      available: false,
      message: 'Community name already exists'
    });
  } catch (error) {
    console.error('Error checking community:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check community'
    });
  }
});

// GET /api/communities/:name - Get specific community with populated data
router.get('/:name', async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name })
      .populate('createdBy', 'username')
      .populate('moderators', 'username')
      .lean();
    
    if (!community) {
      return res.status(404).json({
        success: false,
        error: 'Community not found'
      });
    }
    
    // Format dates
    community.createdAtFormatted = new Date(community.createdAt).toLocaleDateString();
    
    res.json({
      success: true,
      community: community
    });
  } catch (error) {
    console.error('Error fetching community:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch community'
    });
  }
});

// Join community - FIXED with proper response
router.post('/:name/join', auth, async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    if (!community) {
      return res.status(404).json({ 
        success: false,
        error: 'Community not found' 
      });
    }
    
    // Check if already a member
    const isMember = community.members.some(
      member => member.toString() === req.user._id.toString()
    );
    
    if (isMember) {
      return res.status(400).json({ 
        success: false,
        error: 'Already a member' 
      });
    }
    
    // Add user to members
    community.members.push(req.user._id);
    community.memberCount = community.members.length;
    await community.save();
    
    // Populate before sending response
    const populatedCommunity = await Community.findById(community._id)
      .populate('createdBy', 'username')
      .populate('moderators', 'username');
    
    res.json({ 
      success: true,
      message: 'Successfully joined community',
      community: populatedCommunity 
    });
  } catch (error) {
    console.error('Error joining community:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

// Leave community - FIXED with proper response
router.post('/:name/leave', auth, async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    if (!community) {
      return res.status(404).json({ 
        success: false,
        error: 'Community not found' 
      });
    }
    
    // Check if user is the creator
    if (community.createdBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ 
        success: false,
        error: 'Creator cannot leave community. Transfer ownership first.' 
      });
    }
    
    // Check if user is a member
    const isMember = community.members.some(
      member => member.toString() === req.user._id.toString()
    );
    
    if (!isMember) {
      return res.status(400).json({ 
        success: false,
        error: 'Not a member of this community' 
      });
    }
    
    // Remove user from members
    community.members = community.members.filter(
      member => member.toString() !== req.user._id.toString()
    );
    community.memberCount = community.members.length;
    await community.save();
    
    // Populate before sending response
    const populatedCommunity = await Community.findById(community._id)
      .populate('createdBy', 'username')
      .populate('moderators', 'username');
    
    res.json({ 
      success: true,
      message: 'Successfully left community',
      community: populatedCommunity 
    });
  } catch (error) {
    console.error('Error leaving community:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

module.exports = router;