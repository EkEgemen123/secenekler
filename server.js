const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Aktif lobileri ve oyun durumlarını saklamak için bir obje
let lobbies = {};

// 6 haneli rastgele lobi kodu üreten fonksiyon
function generateLobbyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// İstemcilere ana oyun dosyasını sun
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // Yeni Lobi Oluşturma İsteği
    socket.on('createLobby', () => {
        let lobbyCode = generateLobbyCode();
        // Bu kodun daha önce kullanılmadığından emin ol
        while (lobbies[lobbyCode]) {
            lobbyCode = generateLobbyCode();
        }

        // Kullanıcıyı mevcut odalarından çıkar (varsa)
        socket.rooms.forEach(room => {
            if (room !== socket.id) socket.leave(room);
        });
        
        socket.join(lobbyCode); // Oyuncuyu yeni lobi odasına al

        lobbies[lobbyCode] = {
            players: { [socket.id]: 'X' }, // Lobi kuran her zaman X olur
            board: ["", "", "", "", "", "", "", "", ""],
            currentPlayer: 'X',
            isActive: true,
            winner: null
        };
        
        console.log(`Lobi oluşturuldu: ${lobbyCode} - Kurucu: ${socket.id}`);
        socket.emit('lobbyCreated', lobbyCode);
    });

    // Lobiye Katılma İsteği
    socket.on('joinLobby', (lobbyCode) => {
        const lobby = lobbies[lobbyCode];

        if (!lobby) {
            socket.emit('error', 'Lobi bulunamadı!');
            return;
        }

        if (Object.keys(lobby.players).length >= 2) {
            socket.emit('error', 'Bu lobi zaten dolu!');
            return;
        }
        
        // Kullanıcıyı mevcut odalarından çıkar (varsa)
        socket.rooms.forEach(room => {
            if (room !== socket.id) socket.leave(room);
        });

        socket.join(lobbyCode); // Oyuncuyu lobi odasına al
        lobby.players[socket.id] = 'O'; // Katılan oyuncu her zaman O olur

        console.log(`${socket.id} oyuncusu ${lobbyCode} lobisine katıldı.`);
        
        // Oyunu başlatmak için her iki oyuncuya da sinyal gönder
        io.to(lobbyCode).emit('gameStart', {
            lobbyCode: lobbyCode,
            players: lobby.players,
            board: lobby.board,
            currentPlayer: lobby.currentPlayer
        });
    });
    
    // Oyuncu Hamle Yaptığında
    socket.on('makeMove', (data) => {
        const { lobbyCode, index } = data;
        const lobby = lobbies[lobbyCode];
        
        if (!lobby) return;

        const playerSymbol = lobby.players[socket.id];

        // Sıra doğru oyuncuda mı, oyun aktif mi ve hücre boş mu kontrol et
        if (playerSymbol === lobby.currentPlayer && lobby.board[index] === "" && lobby.isActive) {
            lobby.board[index] = lobby.currentPlayer;

            // Kazanma durumunu kontrol et
            const winningLine = checkWinner(lobby.board);
            if (winningLine) {
                lobby.winner = lobby.currentPlayer;
                lobby.isActive = false;
            } else if (!lobby.board.includes("")) { // Beraberlik kontrolü
                lobby.isActive = false;
            } else {
                // Sıradaki oyuncuya geç
                lobby.currentPlayer = lobby.currentPlayer === 'X' ? 'O' : 'X';
            }
            
            // Lobi'deki herkese güncel durumu gönder
            io.to(lobbyCode).emit('updateState', {
                board: lobby.board,
                currentPlayer: lobby.currentPlayer,
                isActive: lobby.isActive,
                winner: lobby.winner,
                winningLine: winningLine
            });
        }
    });
    
    // Yeniden Başlatma İsteği (Lobi içinden)
    socket.on('restartGame', (lobbyCode) => {
        const lobby = lobbies[lobbyCode];
        if (lobby) {
            lobby.board = ["", "", "", "", "", "", "", "", ""];
            lobby.currentPlayer = 'X';
            lobby.isActive = true;
            lobby.winner = null;

            io.to(lobbyCode).emit('updateState', {
                board: lobby.board,
                currentPlayer: lobby.currentPlayer,
                isActive: lobby.isActive,
                winner: null,
                winningLine: null
            });
             io.to(lobbyCode).emit('restart');
        }
    });

    // Bağlantı Koptuğunda
    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);
        // Oyuncunun içinde olduğu lobiyi bul ve yönet
        for (const lobbyCode in lobbies) {
            if (lobbies[lobbyCode].players[socket.id]) {
                delete lobbies[lobbyCode].players[socket.id];
                console.log(`${socket.id}, ${lobbyCode} lobisinden ayrıldı.`);
                // Diğer oyuncuya rakibin ayrıldığı bilgisini gönder
                io.to(lobbyCode).emit('opponentLeft');
                
                // Eğer lobi boşaldıysa, lobiyi sil
                if (Object.keys(lobbies[lobbyCode].players).length === 0) {
                    delete lobbies[lobbyCode];
                    console.log(`Lobi ${lobbyCode} boşaldığı için kapatıldı.`);
                }
                break;
            }
        }
    });
});

function checkWinner(board) {
    const winningCombinations = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (const combination of winningCombinations) {
        const [a, b, c] = combination;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return combination; // Kazanan kombinasyonu döndür
        }
    }
    return null;
}

server.listen(PORT, () => {
    console.log(`Kanka sunucu http://localhost:${PORT} adresinde çalışıyor, haberin olsun`);
});