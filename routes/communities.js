// routes/communities.js
const express = require('express');
const router = express.Router();
const Community = require('../models/Community');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

// ========== STATIC ROUTES (MUST BE BEFORE PARAMETERIZED ROUTES) ==========

// GET /api/communities - Get all communities
router.get('/', async (req, res) => {
  try {
    console.log('📢 GET /api/communities route hit');
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

// GET /api/communities/popular - Get popular communities
router.get('/popular', async (req, res) => {
  try {
    console.log('📢 GET /api/communities/popular route hit');
    
    // Get communities with most members
    const popularCommunities = await Community.find()
      .select('name displayName description memberCount createdAt bannerColor')
      .sort({ memberCount: -1 })
      .limit(10);
    
    res.json({
      success: true,
      communities: popularCommunities || []
    });
  } catch (error) {
    console.error('Error fetching popular communities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch popular communities'
    });
  }
});

// Check if community exists
router.get('/check/:name', async (req, res) => {
  try {
    console.log(`📢 GET /api/communities/check/${req.params.name} route hit`);
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

// ========== PARAMETERIZED ROUTES (MUST BE AFTER STATIC ROUTES) ==========

// GET /api/communities/:name - Get specific community
router.get('/:name', async (req, res) => {
  try {
    console.log(`📢 GET /api/communities/${req.params.name} route hit`);
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

// Create community
router.post('/', auth, async (req, res) => {
  try {
    console.log('📢 POST /api/communities route hit');
    const { name, displayName, description, isPublic, isNSFW } = req.body;
    
    // Validate community name
    const nameRegex = /^[a-z0-9_]+$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({ 
        success: false,
        error: 'Community name can only contain lowercase letters, numbers, and underscores' 
      });
    }
    
    // Check if community exists
    const existingCommunity = await Community.findOne({ name });
    if (existingCommunity) {
      return res.status(400).json({ 
        success: false,
        error: 'Community name already exists' 
      });
    }
    
    // Create community
    const community = new Community({
      name,
      displayName,
      description,
      createdBy: req.user._id,
      moderators: [req.user._id],
      members: [req.user._id],
      memberCount: 1,
      isPublic: isPublic !== false,
      isNSFW: isNSFW || false
    });
    
    await community.save();
    
    res.status(201).json({ 
      success: true,
      community 
    });
  } catch (error) {
    console.error('Error creating community:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

// Join community
router.post('/:name/join', auth, async (req, res) => {
  try {
    console.log(`📢 POST /api/communities/${req.params.name}/join route hit`);
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
    
    res.json({ 
      success: true,
      message: 'Successfully joined community',
      community 
    });
  } catch (error) {
    console.error('Error joining community:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

// Leave community
router.post('/:name/leave', auth, async (req, res) => {
  try {
    console.log(`📢 POST /api/communities/${req.params.name}/leave route hit`);
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
    
    res.json({ 
      success: true,
      message: 'Successfully left community',
      community 
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