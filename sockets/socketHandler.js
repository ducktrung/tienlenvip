const { rooms } = require('../models/roomModel');
const User = require('../models/userModel');
const { canPlayCards } = require('../utils/tienLenLogic');

const getNextTurn = (room, currentUsername) => {
    const activePlayers = room.players.filter(p => !p.isWaiting); 
    if (activePlayers.length === 0) return null; 

    const currentIndex = activePlayers.findIndex(p => p.username === currentUsername);
    let nextIndex = (currentIndex + 1) % activePlayers.length;
    
    while (room.gameState.passedPlayers.includes(activePlayers[nextIndex].username)) {
        nextIndex = (nextIndex + 1) % activePlayers.length;
        if (nextIndex === currentIndex) break; 
    }
    return activePlayers[nextIndex].username;
};

module.exports = (io) => {
    // ==========================================================
    // HỆ THỐNG TRỌNG TÀI BẤM GIỜ & TỰ ĐỘNG ĐÁNH (AFK BOT)
    // ==========================================================
    const forceAutoPlay = (roomId, username) => {
        const room = rooms[roomId];
        if (!room || !room.gameState || room.gameState.currentTurnUsername !== username) return;

        const userHand = room.gameState.hands[username];
        if (!userHand || userHand.length === 0) return;

        // TRƯỜNG HỢP 1: BẮT BUỘC PHẢI ĐÁNH (Bàn trống) -> Chọn lá nhỏ nhất
        if (room.gameState.tablePlays.length === 0) {
            const rankMap = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
            const suitPower = { 'spades': 1, 'clubs': 2, 'diamonds': 3, 'hearts': 4 };
            const sortedHand = [...userHand].sort((a, b) => (rankMap[a.value]*10 + suitPower[a.suit]) - (rankMap[b.value]*10 + suitPower[b.suit]));

            let cardToPlay = sortedHand[0];
            if (!room.lastWinner && room.gameState.isFirstPlay) {
                const reqCard = room.gameState.smallestCard;
                const target = sortedHand.find(c => c.value === reqCard.value && c.suit === reqCard.suit);
                if (target) cardToPlay = target;
            }

            const cards = [cardToPlay];
            room.gameState.isFirstPlay = false;
            room.gameState.lastPlayedUsername = username;
            room.gameState.tablePlays.push({ playedBy: username, cards });
            room.gameState.hands[username] = room.gameState.hands[username].filter(c => c.id !== cardToPlay.id);

            const nextTurn = getNextTurn(room, username);
            room.gameState.currentTurnUsername = nextTurn;
            io.to(roomId).emit('card_played', { playedBy: username, cards, nextTurn });

            if (room.gameState.hands[username].length === 0) {
                room.lastWinner = username;
                const isDutMu = cards.length === 1 && cards[0].value === '3' && cards[0].suit === 'spades';
                setTimeout(() => {
                    io.to(roomId).emit('game_ended', { winner: username, remainingHands: room.gameState.hands, isDutMu });
                    room.gameState = null;
                    if(room.turnTimeout) clearTimeout(room.turnTimeout);
                    room.players.forEach(p => p.isWaiting = false);
                    io.to(roomId).emit('update_players', room.players);
                }, 500);
            } else {
                startTurnTimer(roomId); // Bắt đầu đếm giờ cho thằng tiếp theo
            }
        } 
        // TRƯỜNG HỢP 2: NGƯỜI KHÁC ĐÁNH -> TỰ ĐỘNG BỎ QUA
        else {
            if (!room.gameState.passedPlayers.includes(username)) room.gameState.passedPlayers.push(username);
            const activePlayers = room.players.filter(p => !p.isWaiting);
            let isRoundClear = false; let nextTurn;
            if (room.gameState.passedPlayers.length >= activePlayers.length - 1) {
                isRoundClear = true; nextTurn = room.gameState.lastPlayedUsername;
                room.gameState.passedPlayers = []; room.gameState.tablePlays = [];
            } else {
                nextTurn = getNextTurn(room, username);
            }
            room.gameState.currentTurnUsername = nextTurn;
            io.to(roomId).emit('turn_passed', { passedBy: username, nextTurn, isRoundClear, serverPassedPlayers: room.gameState.passedPlayers });
            startTurnTimer(roomId);
        }
    };

    const startTurnTimer = (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.gameState) return;
        if (room.turnTimeout) clearTimeout(room.turnTimeout);

        // 🟢 THÊM DÒNG NÀY: Ghi nhớ thời điểm bắt đầu lượt (tính bằng milliseconds)
        room.gameState.turnStartTime = Date.now(); 

        room.turnTimeout = setTimeout(() => {
            const currentTurn = room.gameState?.currentTurnUsername;
            if (currentTurn) {
                forceAutoPlay(roomId, currentTurn);
            }
        }, 16000); 
    };

    // ==========================================================
    // CÁC SỰ KIỆN GIAO TIẾP VỚI FRONTEND
    // ==========================================================
    io.on('connection', (socket) => {
        console.log(`🟢 Người chơi kết nối: ${socket.id}`);

        socket.on('join_room', (data, callback) => {
            const { user, roomId, action, baseBet } = data; 
            if (action === 'join' && !rooms[roomId]) {
                if (callback) callback({ success: false, message: "❌ Phòng này không tồn tại!" });
                return;
            }
            socket.join(roomId);

            if (!rooms[roomId]) {
                rooms[roomId] = { players: [], gameState: null, lastWinner: null, baseBet: baseBet || 10000 }; 
            }

            const isPlaying = rooms[roomId].gameState != null; 
            const existingPlayer = rooms[roomId].players.find(p => p.username === user.username);

            // XỬ LÝ KHÔI PHỤC VÀO PHÒNG
            if (existingPlayer) {
                existingPlayer.socketId = socket.id; 
                existingPlayer.isDisconnected = false;
                // io.to(roomId).emit('receive_chat', { username: 'Hệ Thống', text: `🟢 ${user.name} đã kết nối lại!` });
                io.to(roomId).emit('update_players', rooms[roomId].players);
                if (callback) callback({ success: true, players: rooms[roomId].players, baseBet: rooms[roomId].baseBet });

                if (rooms[roomId].gameState) {
                    setTimeout(() => {
                        const state = rooms[roomId].gameState;
                        const myHand = state.hands[user.username] || [];
                        const opponentsInfo = rooms[roomId].players.filter(p => p.username !== user.username)
                            .map(p => ({ username: p.username, cardCount: state.hands[p.username]?.length || 0 }));

                        // 🟢 TÍNH TOÁN THỜI GIAN CÒN LẠI THỰC TẾ
                        let remainingTime = 15;
                        if (state.turnStartTime) {
                            const elapsedSeconds = Math.floor((Date.now() - state.turnStartTime) / 1000);
                            remainingTime = Math.max(0, 15 - elapsedSeconds); // Lấy 15s trừ đi số giây đã trôi qua
                        }

                        socket.emit('reconnect_game', {
                            myHand, opponents: opponentsInfo, currentTurn: state.currentTurnUsername,
                            tablePlays: state.tablePlays, passedPlayers: state.passedPlayers,
                            remainingTime: remainingTime // 🟢 GỬI KÈM SỐ GIÂY CÒN LẠI VỀ CLIENT
                        });
                    }, 1200); 
                }
                return; 
            }

            if (rooms[roomId].players.length < 4) {
                rooms[roomId].players.push({ ...user, socketId: socket.id, isWaiting: isPlaying, isDisconnected: false });
            }
            
            io.to(roomId).emit('update_players', rooms[roomId].players);
            if (callback) callback({ success: true, players: rooms[roomId].players, baseBet: rooms[roomId].baseBet });
            // if (isPlaying) setTimeout(() => { socket.emit('sync_spectator', { gameState: 'playing', tablePlays: rooms[roomId].gameState.tablePlays || [] }); }, 1200);
            if (isPlaying && !existingPlayer) {
                setTimeout(() => {
                    const state = rooms[roomId].gameState;
                    
                    // Khán giả thì không có bài trên tay
                    const myHand = []; 
                    
                    const opponentsInfo = rooms[roomId].players.filter(p => p.username !== user.username)
                        .map(p => ({ username: p.username, cardCount: state.hands[p.username]?.length || 0 }));

                    // Tính toán thời gian thực tế còn lại cho khán giả xem
                    let remainingTime = 15;
                    if (state.turnStartTime) {
                        const elapsedSeconds = Math.floor((Date.now() - state.turnStartTime) / 1000);
                        remainingTime = Math.max(0, 15 - elapsedSeconds);
                    }

                    // Tận dụng luôn event reconnect_game để Frontend vẽ lại y hệt
                    socket.emit('reconnect_game', {
                        myHand, 
                        opponents: opponentsInfo, 
                        currentTurn: state.currentTurnUsername,
                        tablePlays: state.tablePlays, 
                        passedPlayers: state.passedPlayers,
                        remainingTime: remainingTime
                    });
                }, 1200);
            }
        });

        socket.on('leave_room', (data) => {
            const { user, roomId, penaltyPaid } = data;
            const room = rooms[roomId];
            
            if (!room) return;

            // 1. Tìm thông tin người vừa out
            const leavingPlayer = room.players.find(p => p.username === user.username);
            const isSpectator = leavingPlayer ? leavingPlayer.isWaiting : false;

            // 2. XỬ LÝ NẾU NGƯỜI OUT LÀ NGƯỜI CHƠI CHÍNH (Đang cầm bài)
            if (room.gameState != null && !isSpectator) {
                // Đếm số người chơi chính (Không tính khán giả) TRƯỚC khi gạch tên
                const activePlayersBefore = room.players.filter(p => !p.isWaiting);

                // THƯỜNG HỢP 1: Bàn chỉ có 2 người đánh, 1 người out -> Ván kết thúc
                if (activePlayersBefore.length <= 2) {
                    const remainingPlayer = activePlayersBefore.find(p => p.username !== user.username);
                    if (remainingPlayer) {
                        io.to(roomId).emit('opponent_fled', { 
                            winner: remainingPlayer.username, 
                            quitter: user.username, 
                            reward: penaltyPaid 
                        });
                    }
                    room.gameState = null; 
                    if(room.turnTimeout) clearTimeout(room.turnTimeout);
                    
                    // Gạch tên người thoát
                    room.players = room.players.filter(p => p.username !== user.username);
                    io.to(roomId).emit('update_players', room.players);
                } 
                // TRƯỜNG HỢP 2: Bàn có 3-4 người đánh, 1 người out -> Đánh tiếp
                else {
                    // io.to(roomId).emit('receive_chat', { username: 'Hệ Thống', text: `🔴 ${user.name} đã chịu thua rời bàn và bị phạt!` });
                    io.to(roomId).emit('player_penalized', { 
                        message: `🔴 ${user.name} đã bỏ chạy và bị phạt đền tiền!` 
                    });
                    // Nếu người thoát đang là người giữ LƯỢT ĐÁNH
                    if (room.gameState.currentTurnUsername === user.username) {
                        
                        // Tìm người kế tiếp (Dựa vào hàm getNextTurn bạn đã viết sẵn)
                        let nextTurn = getNextTurn(room, user.username);
                        
                        // Tiến hành gạch tên và dọn rác của người vừa out
                        room.players = room.players.filter(p => p.username !== user.username);
                        delete room.gameState.hands[user.username];
                        
                        // Kiểm tra xem sau khi ông này out, bàn đã được Clear chưa
                        const activePlayersNow = room.players.filter(p => !p.isWaiting);
                        const unpassedPlayers = activePlayersNow.filter(p => !room.gameState.passedPlayers.includes(p.username));
                        
                        let isRoundClear = false;
                        if (unpassedPlayers.length <= 1) {
                            isRoundClear = true;
                            nextTurn = room.gameState.lastPlayedUsername;
                            // Đề phòng trường hợp người đánh lá to nhất cũng vừa out luôn
                            if (!activePlayersNow.find(p => p.username === nextTurn)) {
                                nextTurn = activePlayersNow[0].username; 
                            }
                            room.gameState.passedPlayers = [];
                            room.gameState.tablePlays = [];
                        }

                        room.gameState.currentTurnUsername = nextTurn;
                        io.to(roomId).emit('turn_passed', { 
                            passedBy: user.username, 
                            nextTurn: nextTurn, 
                            isRoundClear: isRoundClear, 
                            serverPassedPlayers: room.gameState.passedPlayers 
                        });

                        // Cài lại đồng hồ 16s cho người kế tiếp
                        if (room.turnTimeout) clearTimeout(room.turnTimeout);
                        room.gameState.turnStartTime = Date.now();
                        room.turnTimeout = setTimeout(() => {
                            if (room.gameState && room.gameState.currentTurnUsername) {
                                forceAutoPlay(roomId, room.gameState.currentTurnUsername);
                            }
                        }, 16000);
                        
                    } else {
                        // Nếu không phải lượt của họ, thì việc xóa đi dễ dàng hơn
                        
                        // Ràng buộc bảo vệ ván bài: Nếu họ là người quăng lá bài to nhất trên bàn, chuyển quyền "Bá chủ vòng" lại cho 1 người còn sống để ván bài không bị kẹt
                        if (room.gameState.lastPlayedUsername === user.username) {
                            const activePlayersNow = room.players.filter(p => p.username !== user.username && !p.isWaiting);
                            room.gameState.lastPlayedUsername = activePlayersNow[0].username;
                        }
                        
                        // Gạch tên và xóa bài trên tay họ
                        room.players = room.players.filter(p => p.username !== user.username);
                        delete room.gameState.hands[user.username];
                    }
                    
                    // Cập nhật giao diện mảng người chơi mới
                    io.to(roomId).emit('update_players', room.players);
                }
            } 
            // 3. NẾU LÀ KHÁN GIẢ HOẶC PHÒNG ĐANG CHỜ (Chưa start)
            else {
                room.players = room.players.filter(p => p.username !== user.username);
                io.to(roomId).emit('update_players', room.players);
            }

            // Dọn dẹp phòng trống
            if (room.players.length === 0) delete rooms[roomId];
            
            socket.leave(roomId);
        });

        socket.on('start_game', (data) => {
            const { roomId } = data;
            const room = rooms[roomId];
            
            if (!room || room.players.length < 2 || room.gameState != null) return;

            room.players.forEach(p => p.isWaiting = false);
            io.to(roomId).emit('update_players', room.players);

            const suits = ['spades', 'clubs', 'diamonds', 'hearts'];
            const values = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
            let deck = [];
            suits.forEach(suit => values.forEach(value => deck.push({ id: `${value}-${suit}`, suit, value })));
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            const dealtHands = {};
            room.players.forEach((player, index) => {
                dealtHands[player.username] = deck.slice(index * 13, (index + 1) * 13);
            });

            let firstTurnUsername = null;
            let smallestCard = null; 
            if (room.lastWinner && room.players.find(p => p.username === room.lastWinner)) {
                firstTurnUsername = room.lastWinner;
            } else {
                let minRank = 99; let minSuit = 99;
                for (let username in dealtHands) {
                    dealtHands[username].forEach(card => {
                        let vIdx = values.indexOf(card.value);
                        let sIdx = suits.indexOf(card.suit);
                        if (vIdx < minRank || (vIdx === minRank && sIdx < minSuit)) {
                            minRank = vIdx; minSuit = sIdx; firstTurnUsername = username;
                            smallestCard = { value: card.value, suit: card.suit };
                        }
                    });
                }
            }

            room.gameState = { passedPlayers: [], lastPlayedUsername: firstTurnUsername, currentTurnUsername: firstTurnUsername, hands: dealtHands, tablePlays: [], isFirstPlay: true, smallestCard: smallestCard };

            room.players.forEach((player) => {
                const opponentsInfo = room.players.filter(p => p.username !== player.username).map(p => ({ username: p.username, cardCount: dealtHands[p.username]?.length || 0 }));
                io.to(player.socketId).emit('game_started', { myHand: dealtHands[player.username], firstTurn: firstTurnUsername, opponents: opponentsInfo });
            });
            
            // GỌI TRỌNG TÀI BẤM GIỜ
            startTurnTimer(roomId);
        });

        socket.on('play_cards', (data) => {
            const { roomId, user, cards } = data;
            const room = rooms[roomId];
            
            if (!room || !room.gameState) return;

            // 🛑 BẢO VỆ 1: Kiểm tra đúng lượt không, nếu không chặn ngay và báo lỗi
            if (room.gameState.currentTurnUsername !== user.username) {
                socket.emit('play_error', { message: 'Đã hết thời gian hoặc hiện tại không phải lượt của bạn!' });
                return;
            }

            const userHand = room.gameState.hands[user.username];
            const hasAllCards = cards.every(playedCard => userHand.some(handCard => handCard.value === playedCard.value && handCard.suit === playedCard.suit));
            if (!hasAllCards) return; 

            const activeTableCards = room.gameState.tablePlays && room.gameState.tablePlays.length > 0 ? room.gameState.tablePlays[room.gameState.tablePlays.length - 1].cards : [];
            const ruleCheck = canPlayCards(cards, activeTableCards);
            
            // 🛑 BẢO VỆ 2: Chặn bài không hợp lệ và báo lỗi cho Client
            if (!ruleCheck.valid) {
                socket.emit('play_error', { message: 'Bài đánh không hợp lệ!' });
                return; 
            }

            if (!room.lastWinner && room.gameState.isFirstPlay) {
                const reqCard = room.gameState.smallestCard; 
                const hasSmallestCard = cards.some(c => c.value === reqCard.value && c.suit === reqCard.suit);
                if (!hasSmallestCard) {
                    const suitNames = { 'spades': 'Bích', 'clubs': 'Chuồn', 'diamonds': 'Rô', 'hearts': 'Cơ' };
                    socket.emit('play_error', { message: `Ván đầu tiên bắt buộc phải đánh lá ${reqCard.value} ${suitNames[reqCard.suit]}!` });
                    return; 
                }
            }

            room.gameState.isFirstPlay = false; 
            room.gameState.lastPlayedUsername = user.username;
            if (!room.gameState.tablePlays) room.gameState.tablePlays = [];
            room.gameState.tablePlays.push({ playedBy: user.username, cards: cards });

            room.gameState.hands[user.username] = room.gameState.hands[user.username].filter(
                c => !cards.some(playedCard => playedCard.value === c.value && playedCard.suit === c.suit)
            );

            const nextTurn = getNextTurn(room, user.username);
            room.gameState.currentTurnUsername = nextTurn;
            io.to(roomId).emit('card_played', { playedBy: user.username, cards: cards, nextTurn: nextTurn });

            if (room.gameState.hands[user.username].length === 0) {
                room.lastWinner = user.username;
                const isDutMu = cards.length === 1 && cards[0].value === '3' && cards[0].suit === 'spades';
                setTimeout(() => {
                    io.to(roomId).emit('game_ended', { winner: user.username, remainingHands: room.gameState.hands, isDutMu: isDutMu });
                    room.gameState = null; 
                    if(room.turnTimeout) clearTimeout(room.turnTimeout);
                    room.players.forEach(p => p.isWaiting = false);
                    io.to(roomId).emit('update_players', room.players);
                }, 500);
            } else {
                startTurnTimer(roomId); // Bấm giờ cho người tiếp theo
            }
        });

        socket.on('pass_turn', (data) => {
            const { user, roomId } = data;
            const room = rooms[roomId];
            
            if (room && room.gameState) {
                // 🛑 BẢO VỆ 3: Phải kiểm tra lượt trước khi cho phép Bỏ qua
                if (room.gameState.currentTurnUsername !== user.username) {
                    socket.emit('play_error', { message: 'Lượt đã qua, không thể thao tác!' });
                    return; 
                }

                if (!room.gameState.passedPlayers.includes(user.username)) {
                    room.gameState.passedPlayers.push(user.username);
                }
                
                const activePlayers = room.players.filter(p => !p.isWaiting);
                let isRoundClear = false; 
                let nextTurn;
                
                if (room.gameState.passedPlayers.length >= activePlayers.length - 1) {
                    isRoundClear = true; 
                    nextTurn = room.gameState.lastPlayedUsername; 
                    room.gameState.passedPlayers = []; 
                    room.gameState.tablePlays = [];
                } else {
                    nextTurn = getNextTurn(room, user.username); 
                }
                
                room.gameState.currentTurnUsername = nextTurn;
                io.to(roomId).emit('turn_passed', { passedBy: user.username, nextTurn: nextTurn, isRoundClear: isRoundClear, serverPassedPlayers: room.gameState.passedPlayers });
                
                startTurnTimer(roomId); // Bấm giờ cho người tiếp theo
            }
        });

        // XỬ LÝ KHI NGƯỜI CHƠI ĐÓNG TAB (RỚT MẠNG) - KHÔNG ĐUỔI RA NỮA!
        socket.on('disconnect', () => {
            console.log(`🔴 Mất kết nối: ${socket.id}`);
            for (const roomId in rooms) {
                const room = rooms[roomId];
                const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
                
                if (playerIndex !== -1) {
                    // Cắm cờ báo là nó rớt mạng để chờ Bot đánh giùm
                    room.players[playerIndex].isDisconnected = true;
                    
                    if (room.gameState && !room.players[playerIndex].isWaiting) {
                        io.to(roomId).emit('update_players', room.players);
                    } else {
                        // Đang ở sảnh mà thoát thì xóa luôn
                        room.players.splice(playerIndex, 1);
                        io.to(roomId).emit('update_players', room.players);
                        if (room.players.length === 0) delete rooms[roomId];
                    }
                    break;
                }
            }
        });
        socket.on('sync_money', (data) => {
            const { roomId, money } = data;
            const room = rooms[roomId];
            
            if (room) {
                // Tìm người chơi đang gắn với socket này
                const player = room.players.find(p => p.socketId === socket.id);
                if (player) {
                    player.money = money; // Cập nhật tiền mới vào "não" Server
                    
                    // Phát thông báo cho TẤT CẢ NHỮNG NGƯỜI KHÁC trong phòng để họ cập nhật UI
                    socket.to(roomId).emit('update_players', room.players); 
                }
            }
        });
        socket.on('send_troll', (data) => { socket.to(data.roomId).emit('receive_troll', data); });
        socket.on('declare_winner', (data) => { if (rooms[data.roomId]) rooms[data.roomId].lastWinner = data.username; });
        socket.on('send_chat', (data) => { io.to(data.roomId).emit('receive_chat', data); });
        socket.on('send_emoji', (data) => { socket.to(data.roomId).emit('receive_emoji', data); });
        socket.on('mic_ready', (data) => { socket.to(data.roomId).emit('peer_mic_ready', { socketId: socket.id, username: data.username }); });
        socket.on('webrtc_signal', (data) => { io.to(data.toSocketId).emit('webrtc_signal', { fromSocketId: socket.id, signal: data.signal }); });
        socket.on('mic_stopped', (data) => { socket.to(data.roomId).emit('peer_mic_stopped', { socketId: socket.id }); });
        socket.on('global_announcement', (data) => { io.emit('receive_announcement', data); });
    });
};