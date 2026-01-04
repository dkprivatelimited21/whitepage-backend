const express = require('express');
const router = express.Router();
const Community = require('../models/Community');
const auth = require('../middleware/auth');
const Post = require('../models/Post');

// Create community
router.post('/', auth, async (req, res) => {
  try {
    const { name, displayName, description, isPublic, isNSFW } = req.body;
    
    // Validate community name
    const nameRegex = /^[a-z0-9_]+$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({ 
        error: 'Community name can only contain lowercase letters, numbers, and underscores' 
      });
    }
    
    // Check if community exists
    const existingCommunity = await Community.findOne({ name });
    if (existingCommunity) {
      return res.status(400).json({ error: 'Community name already exists' });
    }
    
    // Create community
    const community = new Community({
      name,
      displayName,
      description,
      createdBy: req.user.id,  // Fixed: changed from 'owner'
      moderators: [req.user.id],
      members: [req.user.id],
      isPublic: isPublic !== false,
      isNSFW: isNSFW || false
    });
    
    await community.save();
    
    res.status(201).json({ community });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join community
router.post('/:name/join', auth, async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    if (!community) {
      return res.status(404).json({ error: 'Community not found' });
    }
    
    if (community.members.includes(req.user.id)) {
      return res.status(400).json({ error: 'Already a member' });
    }
    
    community.members.push(req.user.id);
    community.memberCount += 1;
    await community.save();
    
    res.json({ community });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Leave community
router.post('/:name/leave', auth, async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    if (!community) {
      return res.status(404).json({ error: 'Community not found' });
    }
    
    if (community.createdBy.toString() === req.user.id) {  // Fixed: changed from 'owner'
      return res.status(400).json({ error: 'Owner cannot leave community' });
    }
    
    community.members = community.members.filter(
      member => member.toString() !== req.user.id
    );
    community.memberCount -= 1;
    await community.save();
    
    res.json({ community });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/communities - Get all communities
router.get('/', async (req, res) => {
  try {
    const communities = await Community.find()
      .select('name displayName description memberCount createdAt')
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

// GET /api/communities/popular - Get popular communities sorted by member count
router.get('/popular', async (req, res) => {
  try {
    // Get communities with most members
    const popularCommunities = await Community.find()
      .select('name displayName description memberCount createdAt')
      .sort({ memberCount: -1 })
      .limit(10); // Limit to top 10
    
    res.json({
      success: true,
      communities: popularCommunities
    });
  } catch (error) {
    console.error('Error fetching popular communities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch popular communities'
    });
  }
});

// GET /api/communities/:name - Get specific community
router.get('/:name', async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name })
      .select('name displayName description memberCount rules createdAt');
    
    if (!community) {
      return res.status(404).json({
        success: false,
        error: 'Community not found'
      });
    }
    
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

// Check if community exists
router.get('/check/:name', async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name });
    
    if (!community) {
      return res.status(404).json({
        success: false,
        exists: false,
        error: 'Community not found'
      });
    }
    
    res.json({
      success: true,
      exists: true,
      community: {
        name: community.name,
        displayName: community.displayName,
        description: community.description,
        memberCount: community.memberCount
      }
    });
  } catch (error) {
    console.error('Error checking community:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check community'
    });
  }
});

module.exports = router;