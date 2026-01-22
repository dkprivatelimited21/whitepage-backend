// routes/search.js
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const Community = require('../models/Community');

/* ---------------------------------------------------
   COMPREHENSIVE SEARCH ENDPOINT
   Supports: posts, communities, users
--------------------------------------------------- */
router.get('/', async (req, res) => {
  try {
    const { q: query, type = 'all', page = 1, limit = 10 } = req.query;
    
    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchQuery = query.trim();
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log(`Searching for: "${searchQuery}", type: ${type}`);

    let results = {
      posts: [],
      communities: [],
      users: []
    };

    let totalCount = 0;

    // SEARCH POSTS
    if (type === 'all' || type === 'posts') {
      const postConditions = [
        { title: { $regex: searchQuery, $options: 'i' } },
        { content: { $regex: searchQuery, $options: 'i' } }
      ];

      // Also search in subreddit if community search is included
      if (type === 'all' || type === 'posts') {
        postConditions.push({ subreddit: { $regex: searchQuery, $options: 'i' } });
      }

      const postQuery = { $or: postConditions };
      const postsLimit = type === 'posts' ? limitNum : 5;

      const [posts, postTotal] = await Promise.all([
        Post.find(postQuery)
          .populate('author', 'username')
          .sort({ createdAt: -1 })
          .skip(type === 'posts' ? skip : 0)
          .limit(postsLimit)
          .lean(),
        type === 'posts' ? Post.countDocuments(postQuery) : Promise.resolve(0)
      ]);

      results.posts = posts.map(post => {
        const upvoteCount = post.upvotes?.length || 0;
        const downvoteCount = post.downvotes?.length || 0;
        const voteCount = upvoteCount - downvoteCount;

        return {
          _id: post._id,
          title: post.title,
          content: post.content?.substring(0, 200) || '',
          subreddit: post.subreddit,
          author: {
            _id: post.author?._id,
            username: post.author?.username || 'deleted'
          },
          votes: voteCount,
          commentCount: post.commentCount || 0,
          createdAt: post.createdAt,
          externalLink: post.externalLink
        };
      });

      if (type === 'posts') {
        totalCount = postTotal;
      }
    }

    // SEARCH COMMUNITIES
    if (type === 'all' || type === 'communities') {
      try {
        const communityConditions = [
          { name: { $regex: searchQuery, $options: 'i' } },
          { displayName: { $regex: searchQuery, $options: 'i' } },
          { description: { $regex: searchQuery, $options: 'i' } }
        ];

        const communityQuery = { $or: communityConditions };
        const communityLimit = type === 'communities' ? limitNum : 5;

        const [communities, communityTotal] = await Promise.all([
          Community.find(communityQuery)
            .populate('createdBy', 'username')
            .sort({ memberCount: -1 })
            .skip(type === 'communities' ? skip : 0)
            .limit(communityLimit)
            .lean(),
          type === 'communities' ? Community.countDocuments(communityQuery) : Promise.resolve(0)
        ]);

        results.communities = communities.map(community => ({
          _id: community._id,
          name: community.name,
          displayName: community.displayName || community.name,
          description: community.description,
          memberCount: community.memberCount || community.members?.length || 0,
          isPublic: community.isPublic,
          isNSFW: community.isNSFW,
          createdAt: community.createdAt,
          createdBy: community.createdBy
        }));

        if (type === 'communities') {
          totalCount = communityTotal;
        }
      } catch (error) {
        console.log('Community search not available:', error.message);
        results.communities = [];
      }
    }

    // SEARCH USERS
    if (type === 'all' || type === 'users') {
      const userQuery = {
        $or: [
          { username: { $regex: searchQuery, $options: 'i' } },
          { email: { $regex: searchQuery, $options: 'i' } }
        ]
      };

      const userLimit = type === 'users' ? limitNum : 5;

      const [users, userTotal] = await Promise.all([
        User.find(userQuery)
          .select('username email karma bio createdAt socialLinks')
          .sort({ karma: -1 })
          .skip(type === 'users' ? skip : 0)
          .limit(userLimit)
          .lean(),
        type === 'users' ? User.countDocuments(userQuery) : Promise.resolve(0)
      ]);

      results.users = users.map(user => ({
        _id: user._id,
        username: user.username,
        email: user.email,
        karma: user.karma || 0,
        bio: user.bio,
        createdAt: user.createdAt,
        socialLinks: user.socialLinks || []
      }));

      if (type === 'users') {
        totalCount = userTotal;
      }
    }

    // For 'all' type, combine and limit results
    if (type === 'all') {
      const allResults = [];
      
      // Add posts with type indicator
      results.posts.slice(0, 3).forEach(post => {
        allResults.push({
          ...post,
          searchType: 'post',
          displayText: post.title
        });
      });
      
      // Add communities with type indicator
      results.communities.slice(0, 2).forEach(community => {
        allResults.push({
          ...community,
          searchType: 'community',
          displayText: `grp/${community.name}`
        });
      });
      
      // Add users with type indicator
      results.users.slice(0, 2).forEach(user => {
        allResults.push({
          ...user,
          searchType: 'user',
          displayText: `u/${user.username}`
        });
      });

      // Sort by relevance (simplified: newer first)
      allResults.sort((a, b) => {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      results.all = allResults;
    }

    const response = {
      success: true,
      query: searchQuery,
      type: type,
      results: results,
      total: totalCount,
      page: type !== 'all' ? pageNum : 1,
      totalPages: type !== 'all' ? Math.ceil(totalCount / limitNum) : 1
    };

    res.json(response);

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

/* ---------------------------------------------------
   QUICK SEARCH FOR AUTOCOMPLETE
--------------------------------------------------- */
router.get('/quick', async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        posts: [],
        communities: [],
        users: []
      });
    }

    const searchQuery = query.trim();
    
    const [posts, communities, users] = await Promise.all([
      // Quick post search (title only)
      Post.find({ title: { $regex: searchQuery, $options: 'i' } })
        .select('title subreddit createdAt')
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
      
      // Quick community search
      Community.find({
        $or: [
          { name: { $regex: searchQuery, $options: 'i' } },
          { displayName: { $regex: searchQuery, $options: 'i' } }
        ]
      })
      .select('name displayName memberCount')
      .sort({ memberCount: -1 })
      .limit(2)
      .lean(),
      
      // Quick user search
      User.find({ username: { $regex: searchQuery, $options: 'i' } })
        .select('username karma')
        .sort({ karma: -1 })
        .limit(2)
        .lean()
    ]);

    const response = {
      success: true,
      query: searchQuery,
      results: {
        posts: posts.map(post => ({
          _id: post._id,
          title: post.title,
          subreddit: post.subreddit,
          type: 'post'
        })),
        communities: communities.map(community => ({
          _id: community._id,
          name: community.name,
          displayName: community.displayName || community.name,
          memberCount: community.memberCount || 0,
          type: 'community'
        })),
        users: users.map(user => ({
          _id: user._id,
          username: user.username,
          karma: user.karma || 0,
          type: 'user'
        }))
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Quick search error:', error);
    res.json({
      success: true,
      posts: [],
      communities: [],
      users: []
    });
  }
});

module.exports = router;