// server/controllers/gameController.js
const { rooms } = require('../models/roomModel');

// Viết sẵn 1 API test lấy danh sách phòng đang có
const getActiveRooms = (req, res) => {
    res.json({ success: true, activeRooms: Object.keys(rooms) });
};

module.exports = {
    getActiveRooms
};