// modules/socketHandlers.js

module.exports = function(io) {
    // Хранилища комнат и ников
    const rooms     = {};   // { roomId: { id, name, players[], statuses, round, currentTurnIndex } }
    const nicknames = {};   // socket.id → nickname

    // Базовые статы по классу корабля
    const classStats = {
        'Фрегат':   { speed:5,  maneuverability:1,  armor:5,  points:4,  activation:2 },
        'Эсминец':  { speed:4,  maneuverability:1,  armor:6,  points:8,  activation:3 },
        'Крейсер':  { speed:3,  maneuverability:1,  armor:7,  points:12, activation:4 },
        'Линкор':   { speed:2,  maneuverability:1,  armor:8,  points:16, activation:5 },
        'Дредноут': { speed:1,  maneuverability:1,  armor:9,  points:20, activation:6 }
    };

    // Бросок N кубиков D6
    function rollDice(n) {
        const counts = {1:0,2:0,3:0,4:0,5:0,6:0};
        for (let i = 0; i < n; i++) {
            const face = Math.floor(Math.random() * 6) + 1;
            counts[face]++;
        }
        return counts;
    }

    // Рассылка списка комнат всем подключённым
    function broadcastRoomsData() {
        const list = Object.values(rooms).map(r => ({
            roomId:  r.id,
            name:    r.name,
            players: r.players.map(id => ({
                nick:  nicknames[id] || '—',
                ready: !!(r.statuses[id] && r.statuses[id].ready)
            }))
        }));
        io.emit('roomsData', list);
    }

    /**
     * Инициализация placement-фазы и раздача начального состояния
     */
    function startBattle(roomId) {
        const room = rooms[roomId];
        const fleets = Object.entries(room.battle.fleets); // [ [socketId, fleet], … ]

        // 1) Собираем pendingPlacement по каждому флоту
        const pendingPlacement = {};
        fleets.forEach(([pid, fleet]) => {
            pendingPlacement[pid] = fleet.composition.map(c => ({
                shipClass: c.shipClass,
                projectId: c.projectId,
                count:     c.count
            }));
        });

        // 2) Случайный первый расстановщик
        const firstPlacer = fleets[Math.floor(Math.random() * fleets.length)][0];

        // 3) Формируем состояние в фазе placement
        room.battle.state = {
            id:               roomId,
            phase:            'placement',
            currentPlayer:    firstPlacer,
            pendingPlacement: pendingPlacement,
            ships:            [],
            map:              { width:11, height:11, obstacles:[] }
        };
        room.battle.commands = {}; // пока не нужны

        // 4) Оповещаем оба клиента
        console.log('Sending battleState to clients:', room.battle.state);
        io.to(`battle_${roomId}`).emit('battleState', room.battle.state);
    }

    /**
     * Проверка валидности позиции для размещения корабля
     */
    function isValidPosition(ships, position) {
        // Проверяем, не занята ли позиция
        return !ships.some(ship =>
            ship.position.q === position.q &&
            ship.position.r === position.r &&
            ship.position.s === position.s
        );
    }

    io.on('connection', socket => {
        console.log('Player connected:', socket.id);

        // Присваиваем дефолтный ник и отсылаем список комнат
        nicknames[socket.id] = `Player_${socket.id.slice(0,5)}`;
        broadcastRoomsData();

        // Смена ника
        socket.on('setNickname', nick => {
            if (typeof nick === 'string' && nick.trim()) {
                nicknames[socket.id] = nick.trim();
                broadcastRoomsData();
            }
        });

        // Создание новой комнаты
        socket.on('createRoom', (data, cb) => {
            const roomId = `room_${Date.now()}_${socket.id}`;
            rooms[roomId] = {
                id:                roomId,
                name:              data.roomName || roomId,
                players:           [socket.id],
                statuses:          {},
                round:             1,
                currentTurnIndex:  0
            };
            socket.join(roomId);
            console.log('Room created:', roomId);
            cb({ roomId, roomName: rooms[roomId].name });
            broadcastRoomsData();
        });

        // Запрос списка комнат
        socket.on('getRooms', (_, cb) => {
            const list = Object.values(rooms).map(r => ({
                roomId:  r.id,
                name:    r.name,
                players: r.players.map(id => ({
                    nick:  nicknames[id] || '—',
                    ready: !!(r.statuses[id] && r.statuses[id].ready)
                }))
            }));
            cb(list);
        });

        // Вход в существующую комнату
        socket.on('joinRoom', (roomId, cb) => {
            const room = rooms[roomId];
            if (!room) return cb({ success: false, error: 'Комната не существует' });
            if (room.players.length >= 2) return cb({ success: false, error: 'Комната заполнена' });
            room.players.push(socket.id);
            socket.join(roomId);
            console.log('Player joined room:', socket.id, roomId);
            cb({ success: true, roomId });
            broadcastRoomsData();
            io.to(roomId).emit('playerJoined', {
                roomId,
                players: room.players.map(id => nicknames[id])
            });
        });

        /**
         * Игрок сигнализирует, что готов к бою.
         * После двух готовых запускаем placement-фазу.
         */
        socket.on('playerReady', data => {
            console.log('Player ready:', socket.id, data.roomId);
            const room = rooms[data.roomId];
            if (!room) return;

            // Сохраняем флот и отмечаем готовность
            room.statuses[socket.id] = { ready: true, fleet: data.fleet };
            broadcastRoomsData();

            // Подписываем игрока на комнату боя
            socket.join(`battle_${data.roomId}`);

            // Если оба игрока готовы — инициализируем room.battle и стартуем бой
            if (Object.keys(room.statuses).length === 2) {
                console.log('Both players ready, starting battle');
                room.battle = { fleets: {} };
                room.players.forEach(pid => {
                    room.battle.fleets[pid] = room.statuses[pid].fleet;
                });
                startBattle(data.roomId);
            }
        });

        /**
         * Расстановка корабля в фазе placement
         */
        socket.on('placeShip', ({ roomId, projectId, position }) => {
            console.log('placeShip received:', { roomId, projectId, position, socketId: socket.id });

            const room = rooms[roomId];
            if (!room || !room.battle) {
                console.log('Room or battle not found');
                return;
            }

            const b = room.battle;
            if (b.state.phase !== 'placement') {
                console.log('Not in placement phase:', b.state.phase);
                return;
            }

            if (b.state.currentPlayer !== socket.id) {
                console.log('Not current player:', b.state.currentPlayer, socket.id);
                return;
            }

            // Проверяем валидность позиции
            if (!isValidPosition(b.state.ships, position)) {
                console.log('Invalid position - already occupied');
                socket.emit('placementError', { message: 'Позиция уже занята' });
                return;
            }

            // Уменьшаем count в pendingPlacement
            const pending = b.state.pendingPlacement[socket.id];
            const item = pending.find(x => x.projectId === projectId);
            if (!item || item.count <= 0) {
                console.log('Ship not available for placement:', projectId);
                return;
            }

            item.count--;
            if (item.count === 0) {
                pending.splice(pending.indexOf(item), 1);
            }

            // Добавляем корабль на поле
            const newShip = {
                id:        `${socket.id}_${projectId}_${Date.now()}`,
                owner:     socket.id,
                shipClass: item.shipClass,
                projectId,
                position,
                hp:        classStats[item.shipClass].activation,
                modules:   []
            };

            b.state.ships.push(newShip);
            console.log('Ship placed:', newShip);

            // Переключаем currentPlayer или переходим в фазу battle
            const otherPlayerId = room.players.find(id => id !== socket.id);
            const otherPending = b.state.pendingPlacement[otherPlayerId];

            if (pending.length > 0) {
                // У текущего игрока еще есть корабли для расстановки
                b.state.currentPlayer = socket.id;
            } else if (otherPending && otherPending.length > 0) {
                // Переключаемся на другого игрока
                b.state.currentPlayer = otherPlayerId;
            } else {
                // Все корабли расставлены - переходим в бой
                b.state.phase = 'battle';
                b.state.round = 1;
                b.state.currentPlayer = room.players[0]; // Первый игрок начинает бой
                console.log('Placement complete, starting battle phase');
            }

            // Разослать обновлённый state
            console.log('Sending updated battleState');
            io.to(`battle_${roomId}`).emit('battleState', b.state);
        });

        /**
         * Завершение хода в боевой фазе
         */
        socket.on('endTurn', ({ roomId }) => {
            console.log('endTurn received from:', socket.id, 'room:', roomId);

            const room = rooms[roomId];
            if (!room || !room.battle || !room.battle.state) {
                console.log('Room or battle not found');
                return;
            }

            const battleState = room.battle.state;

            // Проверяем, что сейчас ход этого игрока
            if (battleState.currentPlayer !== socket.id) {
                console.log('Not current player turn');
                socket.emit('turnError', { message: 'Сейчас не ваш ход' });
                return;
            }

            // Проверяем, что мы в боевой фазе
            if (battleState.phase !== 'battle') {
                console.log('Not in battle phase');
                return;
            }

            // Переключаем игрока
            const otherPlayer = room.players.find(id => id !== socket.id);
            battleState.currentPlayer = otherPlayer;

            // Увеличиваем раунд, если ход вернулся к первому игроку
            if (battleState.currentPlayer === room.players[0]) {
                battleState.round++;
                console.log(`Starting round ${battleState.round}`);

                // Здесь можно добавить логику начала нового раунда
                // Например, восстановление движения кораблей, перераспределение кубиков и т.д.
            }

            console.log(`Turn passed to: ${nicknames[battleState.currentPlayer]}`);

            // Отправляем обновленное состояние
            io.to(`battle_${roomId}`).emit('battleState', battleState);

            // Логируем смену хода
            io.to(`battle_${roomId}`).emit('turnChanged', {
                currentPlayer: battleState.currentPlayer,
                currentPlayerNick: nicknames[battleState.currentPlayer],
                round: battleState.round
            });
        });

        // Сдача
        socket.on('surrender', () => {
            const roomId = Object.keys(rooms).find(r => rooms[r].players.includes(socket.id));
            if (!roomId) return;
            io.to(roomId).emit('gameOver', { loser: nicknames[socket.id] });
            delete rooms[roomId];
            broadcastRoomsData();
        });

        // Отключение клиента
        socket.on('disconnect', () => {
            console.log('Player disconnected:', socket.id);
            delete nicknames[socket.id];
            for (const id in rooms) {
                const room = rooms[id];
                if (room.players.includes(socket.id)) {
                    room.players = room.players.filter(pid => pid !== socket.id);
                    delete room.statuses[socket.id];
                    io.to(id).emit('playerLeft', { roomId: id, socketId: socket.id });
                    if (room.players.length === 0) delete rooms[id];
                }
            }
            broadcastRoomsData();
        });
    });
};