const express = require('express');
const router = express.Router();
const Community = require('../models/Community');
const auth = require('../middleware/auth');

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
      owner: req.user.id,
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

// Get all communities
router.get('/', async (req, res) => {
  try {
    const communities = await Community.find()
      .sort({ memberCount: -1 })
      .limit(50)
      .populate('owner', 'username');
    
    res.json({ communities });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single community
router.get('/:name', async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name })
      .populate('owner', 'username')
      .populate('moderators', 'username');
    
    if (!community) {
      return res.status(404).json({ error: 'Community not found' });
    }
    
    res.json({ community });
  } catch (error) {
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
    
    if (community.owner.toString() === req.user.id) {
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

module.exports = router;