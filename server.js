require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const cors = require('cors'); // <--- GỌI THÊM CORS
const socketHandler = require('./sockets/socketHandler');

// IMPORT BẢN THIẾT KẾ USER MÀ TA VỪA TẠO LÚC NÃY
const User = require('./models/userModel'); 

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ==========================================
// CẤU HÌNH EXPRESS CORS & JSON
// ==========================================
app.use(cors({
    origin: '*', // Cho phép mọi IP gọi API
    methods: ['GET', 'POST']
}));


const server = http.createServer(app);
const io = require("socket.io")(server, {
    cors: {
        origin: "*", // Mở toang cửa cho điện thoại kết nối Socket
        methods: ["GET", "POST"]
    }
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🟢 Đã kết nối thành công với Ngân Hàng MongoDB Atlas!'))
    .catch(err => console.log('❌ Lỗi kết nối MongoDB:', err));

// ==========================================
// API ĐĂNG KÝ TÀI KHOẢN (REGISTER)
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, name, avatar } = req.body;
        
        // Kiểm tra xem tên đăng nhập có ai xài chưa
        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.status(400).json({ success: false, message: "Tên đăng nhập đã tồn tại!" });
        }

        // Tạo tài khoản mới, tặng luôn 500k làm vốn
        const newUser = new User({
            username,
            password, // Trong thực tế người ta sẽ mã hóa (hash) pass, nhưng game anh em chơi nội bộ thì để vậy cho nhanh
            name,
            avatar,
            money: 500000 
        });

        await newUser.save(); // Lưu vào Database!
        
        res.status(201).json({ success: true, user: newUser, message: "Đăng ký thành công!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ", error: error.message });
    }
});

// ==========================================
// API ĐĂNG NHẬP (LOGIN)
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Lục tìm trong Database xem có acc này không
        const user = await User.findOne({ username });
        
        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Sai tên đăng nhập hoặc mật khẩu!" });
        }

        res.status(200).json({ success: true, user, message: "Đăng nhập thành công!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ", error: error.message });
    }
});
app.post('/api/update-money', async (req, res) => {
    try {
        const { username, money } = req.body;

        // Tìm tài khoản và cập nhật số tiền mới nhất vào MongoDB
        const updatedUser = await User.findOneAndUpdate(
            { username: username }, 
            { money: money }, 
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người chơi!" });
        }

        res.status(200).json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ", error: error.message });
    }
});
app.get('/api/user/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (user) {
            res.status(200).json({ success: true, user });
        } else {
            res.status(404).json({ success: false, message: "Không tìm thấy user" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi Server" });
    }
});
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Tìm tất cả user, sắp xếp tiền giảm dần (money: -1), và chỉ lấy 10 người
        const topUsers = await User.find({}, 'username name avatar money')
                                   .sort({ money: -1 })
                                   .limit(10);
        res.status(200).json({ success: true, leaderboard: topUsers });
    } catch (error) {
        console.error("Lỗi lấy BXH:", error);
        res.status(500).json({ success: false, message: "Lỗi Server khi lấy BXH" });
    }
});
// API CHUYỂN TIỀN GIỮA HAI NGƯỜI CHƠI
app.post('/api/transfer-money', async (req, res) => {
    try {
        const { sender, recipient, amount } = req.body;

        // Bắt lỗi cơ bản
        if (!sender || !recipient || amount <= 0) {
            return res.status(400).json({ success: false, message: "Dữ liệu không hợp lệ!" });
        }
        if (sender === recipient) {
            return res.status(400).json({ success: false, message: "Không thể tự tặng tiền cho chính mình!" });
        }

        // 1. Tìm người gửi và kiểm tra số dư (Giả sử bạn dùng MongoDB, model là User)
        const senderUser = await User.findOne({ username: sender });
        if (!senderUser || senderUser.money < amount) {
            return res.status(400).json({ success: false, message: "Số dư không đủ để tặng!" });
        }

        // 2. Tìm người nhận
        const recipientUser = await User.findOne({ username: recipient });
        if (!recipientUser) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người chơi này!" });
        }

        // 3. Thực hiện trừ tiền và cộng tiền
        senderUser.money -= amount;
        recipientUser.money += amount;

        await senderUser.save();
        await recipientUser.save();

        res.json({ success: true, message: "Chuyển tiền thành công!" });
    } catch (error) {
        console.error("Lỗi chuyển tiền:", error);
        res.status(500).json({ success: false, message: "Lỗi hệ thống!" });
    }
});
// API CẬP NHẬT THÔNG TIN NGƯỜI CHƠI
// ==========================================
// API CẬP NHẬT THÔNG TIN NGƯỜI CHƠI (MÔNGO DB)
// ==========================================
app.post('/api/update-profile', async (req, res) => {
    try {
        const { username, name, avatar } = req.body;
        
        // Nhờ MongoDB tìm user theo username và cập nhật tên + avatar mới
        const updatedUser = await User.findOneAndUpdate(
            { username: username }, // Điều kiện tìm kiếm
            { name: name, avatar: avatar }, // Dữ liệu cần cập nhật
            { new: true } // Trả về thông tin user sau khi đã cập nhật xong
        );
        
        if (updatedUser) {
            res.json({ success: true, message: "Đã cập nhật Profile thành công!", user: updatedUser });
        } else {
            res.status(404).json({ success: false, message: "Không tìm thấy tài khoản để cập nhật" });
        }
    } catch (error) {
        console.error("Lỗi cập nhật profile:", error);
        res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ!" });
    }
});
// ==========================================
socketHandler(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT,'0.0.0.0', () => {
    console.log(`🚀 Trạm Trọng Tài đang chạy tại cổng ${PORT}`);
});