// server/routes/apiRoute.js
const express = require('express');
const router = express.Router();
const { getActiveRooms } = require('../controllers/gameController');

// Khai báo route: GET /api/rooms
router.get('/rooms', getActiveRooms);

module.exports = router;