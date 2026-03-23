const mongoose = require('mongoose');

// Định nghĩa cấu trúc của 1 tài khoản người chơi
const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true // Đảm bảo không ai tạo trùng tên đăng nhập
    },
    password: { 
        type: String, 
        required: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    avatar: { 
        type: String, 
        default: 'https://i.pravatar.cc/150?img=1' // Ảnh mặc định nếu không chọn
    },
    money: { 
        type: Number, 
        default: 500000 // Tặng tân thủ 500k làm vốn khởi nghiệp!
    }
}, { timestamps: true }); // Tự động ghi nhớ ngày giờ tạo acc

module.exports = mongoose.model('User', userSchema);