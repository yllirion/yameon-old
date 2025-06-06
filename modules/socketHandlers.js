// modules/socketHandlers.js

module.exports = function(io) {
    // Хранилища комнат и ников
    const rooms     = {};   // { roomId: { id, name, players[], statuses, round, currentTurnIndex } }
    const nicknames = {};   // socket.id → nickname

    // Базовые статы по классу корабля
    const classStats = {
        'Фрегат':   { speed:5,  maneuverability:5,  armor:5,  points:4,  activation:2 },
        'Эсминец':  { speed:4,  maneuverability:6,  armor:6,  points:8,  activation:3 },
        'Крейсер':  { speed:3,  maneuverability:7,  armor:7,  points:12, activation:4 },
        'Линкор':   { speed:2,  maneuverability:8,  armor:8,  points:16, activation:5 },
        'Дредноут': { speed:1,  maneuverability:9,  armor:9,  points:20, activation:6 }
    }; // :contentReference[oaicite:0]{index=0}

    // Бросок N кубиков D6
    function rollDice(n) {
        const counts = {1:0,2:0,3:0,4:0,5:0,6:0};
        for (let i = 0; i < n; i++) {
            const face = Math.floor(Math.random() * 6) + 1;
            counts[face]++;
        }
        return counts;
    } // :contentReference[oaicite:1]{index=1}

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
    } // :contentReference[oaicite:2]{index=2}

    /**
     * Инициализация placement-фазы и раздача начального состояния
     */
    function startBattle(roomId) {
        const room = rooms[roomId];
        // Скопируем флоты из room.statuses → room.battle.fleets
        room.battle = { fleets: {} };
        room.players.forEach(pid => {
            room.battle.fleets[pid] = room.statuses[pid].fleet;
        });

        // 1) Собираем pendingPlacement по каждому флоту
        //    pendingPlacement: { socketId: [ { shipClass, projectId, count }, … ], … }
        const pendingPlacement = {};
        Object.entries(room.battle.fleets).forEach(([pid, fleet]) => {
            pendingPlacement[pid] = fleet.composition.map(c => ({
                shipClass: c.shipClass,
                projectId: c.projectId,
                count:     c.count
            }));
        });

        // 2) Выбираем случайного первого расстановщика
        const allPids = Object.keys(room.battle.fleets);
        const firstPlacer = allPids[Math.floor(Math.random() * allPids.length)];

        // 3) Формируем начальное состояние battleState
        room.battle.state = {
            id:               roomId,
            phase:            'placement',      // Фаза: «расстановка»
            currentPlayer:    firstPlacer,      // ходит первый выбранный
            pendingPlacement: pendingPlacement, // копия массивов composition
            ships:            [],               // пока никого нет на поле
            round:            0,                // раунд ещё не начался
            map:              { width:11, height:11, obstacles:[] } // параметры поля, если нужно
        };
        room.battle.commands = {}; // сюда потом можно класть команды типа «стреляем», «двигаемся» и т. д.

        // 4) Оповещаем всех участников комнаты «battle_<roomId>»
        io.to(`battle_${roomId}`).emit('battleState', room.battle.state);
    }

    io.on('connection', socket => {
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
            const room = rooms[data.roomId];
            if (!room) return;
            // Сохраняем флот и отмечаем готовность
            room.statuses[socket.id] = { ready: true, fleet: data.fleet };
            broadcastRoomsData();

            // Подписываем игрока на комнату боя
            socket.join(`battle_${data.roomId}`);

            // Если оба игрока готовы — инициализируем room.battle и стартуем бой
            if (Object.keys(room.statuses).length === 2) {
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
            const b = rooms[roomId].battle;
            if (!b || b.state.phase !== 'placement' || b.state.currentPlayer !== socket.id) return;

            // Уменьшаем count в pendingPlacement
            const pending = b.state.pendingPlacement[socket.id];
            const item = pending.find(x => x.projectId === projectId);
            if (!item) return;
            item.count--;
            if (item.count === 0) pending.splice(pending.indexOf(item), 1);

            // Добавляем корабль на поле
            b.state.ships.push({
                id:        `${socket.id}_${projectId}_${Date.now()}`,
                owner:     socket.id,
                shipClass: item.shipClass,
                projectId,
                position,
                hp:        classStats[item.shipClass].armor * 10,
                modules:   []
            }); // :contentReference[oaicite:3]{index=3}

            // Переключаем currentPlayer или переходим в фазу battle
            const other = Object.keys(b.state.pendingPlacement).find(id => id !== socket.id);
            if (pending.length > 0) {
                b.state.currentPlayer = socket.id;
            } else if (b.state.pendingPlacement[other].length > 0) {
                b.state.currentPlayer = other;
            } else {
                b.state.phase         = 'battle';
                b.state.round         = 1;
                b.state.currentPlayer = socket.id;
            }

            // Разослать обновлённый state
            io.to(`battle_${roomId}`).emit('battleState', b.state);
        });

        /**
         * Завершение хода в боевой фазе
         */
        socket.on('endTurn', () => {
            const roomId = Object.keys(rooms).find(r => rooms[r].players.includes(socket.id));
            if (!roomId) return;
            const room = rooms[roomId];
            room.currentTurnIndex = 1 - room.currentTurnIndex;
            if (room.currentTurnIndex === 0) {
                room.round++;
                room.players.forEach(pid => {
                    room.statuses[pid].fleet.dicePool = rollDice(room.round);
                });
            }
            const current = room.players[room.currentTurnIndex];
            io.to(roomId).emit('updateGame', {
                fleets: room.statuses,
                currentTurnNick: nicknames[current]
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

        socket.on('battleState', state => {
            if (state.phase === 'placement') {
                renderPlacement(state, showView, socket, playerId);
            } else if (state.phase === 'battle') {
                showView('battle');
                document.getElementById('turnPlayer').textContent =
                    state.currentPlayer === playerId ? 'Ваш ход' : 'Ход соперника';
                renderBattlePanels(state, playerId);
                requestAnimationFrame(() => {
                    drawHexGrid();
                    renderPlacedShips(state.ships);
                });
            }
        });

    });
};

