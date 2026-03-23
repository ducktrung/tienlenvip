// =========================================
// BẢNG QUY ĐỔI SỨC MẠNH LÁ BÀI
// =========================================
const rankMap = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
const suitPower = { 'spades': 1, 'clubs': 2, 'diamonds': 3, 'hearts': 4 }; 

// Hàm tính điểm tuyệt đối của 1 lá bài (Ví dụ: 2 Cơ là to nhất)
const getCardPower = (card) => rankMap[card.value] * 10 + suitPower[card.suit];

// Hàm sắp xếp bài từ nhỏ đến lớn
const sortCards = (cards) => {
    return [...cards].sort((a, b) => getCardPower(a) - getCardPower(b));
};

// =========================================
// 1. NHẬN DIỆN KIỂU BÀI (Đôi, Sảnh, Đôi Thông...)
// =========================================
const getHandType = (cards) => {
    if (!cards || cards.length === 0) return { type: 'invalid' };
    const sorted = sortCards(cards);
    const len = sorted.length;
    const highest = sorted[len - 1]; // Lá quyết định độ lớn
    
    if (len === 1) return { type: 'rac', highest };
    
    const isAllSameRank = sorted.every(c => c.value === sorted[0].value);
    if (len === 2 && isAllSameRank) return { type: 'doi', highest };
    if (len === 3 && isAllSameRank) return { type: 'samco', highest };
    if (len === 4 && isAllSameRank) return { type: 'tuquy', highest };
    
    // Kiểm tra SẢNH (Ví dụ: 3,4,5... Át) - Đặc biệt: Không được phép có Heo (2) trong Sảnh
    const isSanh = len >= 3 && sorted.every((c, i) => {
        if (c.value === '2') return false; 
        if (i === 0) return true;
        return rankMap[c.value] === rankMap[sorted[i-1].value] + 1; // Lá sau phải lớn hơn lá trước 1 nút
    });
    if (isSanh) return { type: 'sanh', highest, length: len };
    
    // Kiểm tra ĐÔI THÔNG (3 hoặc 4 Đôi Thông)
    if (len >= 6 && len % 2 === 0) {
        let isDoiThong = true;
        for (let i = 0; i < len; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) { isDoiThong = false; break; } // Phải là đôi
            if (sorted[i].value === '2') { isDoiThong = false; break; } // Không được có Đôi Heo
            if (i > 0 && rankMap[sorted[i].value] !== rankMap[sorted[i-2].value] + 1) { isDoiThong = false; break; } // Phải liên tiếp
        }
        if (isDoiThong) {
            if (len === 6) return { type: '3doithong', highest };
            if (len === 8) return { type: '4doithong', highest };
        }
    }
    return { type: 'invalid' };
};

// =========================================
// 2. LUẬT CHẶT HEO & ĐÈ HÀNG
// =========================================
const canPlayCards = (playCards, tableCards) => {
    const playType = getHandType(playCards);
    if (playType.type === 'invalid') return { valid: false };
    
    // Bàn trống (Người đi đầu) -> Đánh gì hợp lệ cũng được
    if (!tableCards || tableCards.length === 0) return { valid: true };
    
    const tableType = getHandType(tableCards);
    
    // Đánh bài CÙNG KIỂU, CÙNG SỐ LƯỢNG (Ví dụ: Đôi đè Đôi, Sảnh 3 đè Sảnh 3)
    if (playType.type === tableType.type && playCards.length === tableCards.length) {
        return { valid: getCardPower(playType.highest) > getCardPower(tableType.highest) };
    }
    
    // --- LUẬT CHẶT ĐẶC BIỆT ---
    
    // 1. Bàn đang là 1 con Heo
    if (tableType.type === 'rac' && tableType.highest.value === '2') {
        if (['3doithong', 'tuquy', '4doithong'].includes(playType.type)) return { valid: true };
    }
    // 2. Bàn đang là 1 Đôi Heo
    if (tableType.type === 'doi' && tableType.highest.value === '2') {
        if (['tuquy', '4doithong'].includes(playType.type)) return { valid: true };
    }
    // 3. Đè 3 Đôi Thông (Chỉ Tứ Quý hoặc 4 Đôi Thông mới đè được)
    if (tableType.type === '3doithong') {
        if (['tuquy', '4doithong'].includes(playType.type)) return { valid: true };
    }
    // 4. Đè Tứ Quý (Chỉ 4 Đôi Thông mới đè được Tứ Quý)
    if (tableType.type === 'tuquy') {
        if (playType.type === '4doithong') return { valid: true };
    }
    
    return { valid: false };
};

// =========================================
// 3. KIỂM TRA TỚI TRẮNG (Ngay sau khi chia)
// =========================================
const checkToiTrang = (cards) => {
    const sorted = sortCards(cards);
    
    // 1. Tứ Quý Heo
    if (sorted.filter(c => c.value === '2').length === 4) return "TỨ QUÝ HEO";
    
    // 2. Sảnh Rồng (Từ 3 tới Át) -> Có 12 lá số khác nhau (không tính Heo)
    const uniqueRanks = [...new Set(sorted.map(c => rankMap[c.value]))].filter(r => r !== 15);
    if (uniqueRanks.length === 12) return "SẢNH RỒNG";
    
    // 3. 6 Đôi Bất Kỳ
    let pairs = 0;
    let temp = [...sorted];
    for (let i = 0; i < temp.length - 1; i++) {
        if (temp[i].value === temp[i+1].value) {
            pairs++;
            i++; // Bỏ qua lá tiếp theo để không đếm trùng
        }
    }
    if (pairs >= 6) return "6 ĐÔI THÔNG/BẤT KỲ";
    
    return null;
};

// =========================================
// CÁC HÀM TIỆN ÍCH KHÁC
// =========================================
const createShuffledDeck = () => {
    const suits = ['spades', 'clubs', 'diamonds', 'hearts'];
    const values = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let deck = [];
    suits.forEach(suit => { values.forEach(value => { deck.push({ id: `${value}-${suit}`, suit, value }); }); });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
};

const findValidPlay = (aiHand, tableCards) => {
    return null; 
};

const calculatePenalty = (remainingCards, baseBet) => {
    let penaltyMultiplier = 0;
    
    // Nếu còn nguyên 13 lá -> Bị "Cóng" (Chết ngộp), phạt gấp đôi
    if (remainingCards.length === 13) {
        penaltyMultiplier += 26; 
    } else {
        penaltyMultiplier += remainingCards.length; // Phạt 1 cược cho mỗi lá bài thường
    }

    // Quét tìm Heo để phạt thêm
    remainingCards.forEach(card => {
        if (card.value === '2') {
            // Heo bích/chuồn (Đen) phạt 3 cược, Heo cơ/rô (Đỏ) phạt 6 cược
            if (card.suit === 'spades' || card.suit === 'clubs') penaltyMultiplier += 3;
            if (card.suit === 'hearts' || card.suit === 'diamonds') penaltyMultiplier += 6;
        }
    });

    return penaltyMultiplier * baseBet; 
};

// Xuất khẩu toàn bộ hàm theo chuẩn của Node.js Backend
module.exports = {
    sortCards,
    getCardPower,
    getHandType,
    canPlayCards,
    createShuffledDeck,
    findValidPlay,
    checkToiTrang,
    calculatePenalty
};