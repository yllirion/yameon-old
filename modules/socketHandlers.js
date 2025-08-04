// modules/socketHandlers.js

module.exports = function(io) {
    // Хранилища комнат и ников
    const rooms     = {};   // { roomId: { id, name, players[], statuses, round, currentTurnIndex } }
    const nicknames = {};   // socket.id → nickname

    // Кэш для проектов кораблей
    let shipProjectsCache = {};

    // Направления для кубических координат
    const HEX_DIRECTIONS = [
        { q: -1, r: 0, s: 1 },   // 0: West (left)
        { q: 0, r: -1, s: 1 },   // 1: Northwest (up-left)
        { q: 1, r: -1, s: 0 },   // 2: Northeast (up-right)
        { q: 1, r: 0, s: -1 },   // 3: East (right)
        { q: 0, r: 1, s: -1 },   // 4: Southeast (down-right)
        { q: -1, r: 1, s: 0 }    // 5: Southwest (down-left)
    ];

    // Базовые статы по классу корабля (fallback)
    const classStats = {
        'Фрегат':   { speed:5,  maneuverability:1,  armor:5,  points:4,  activation:2 },
        'Эсминец':  { speed:4,  maneuverability:1,  armor:6,  points:8,  activation:3 },
        'Крейсер':  { speed:3,  maneuverability:1,  armor:7,  points:12, activation:4 },
        'Линкор':   { speed:2,  maneuverability:1,  armor:8,  points:16, activation:5 },
        'Дредноут': { speed:1,  maneuverability:1,  armor:9,  points:20, activation:6 }
    };

    // Базовые характеристики движения по классам (fallback)
    const shipMovementStats = {
        'Фрегат':   { baseMP: 1, baseSP: 3 },
        'Эсминец':  { baseMP: 1, baseSP: 3 },
        'Крейсер':  { baseMP: 1, baseSP: 2 },
        'Линкор':   { baseMP: 1, baseSP: 2 },
        'Дредноут': { baseMP: 1, baseSP: 1 }
    };

    /**
     * Загружает проекты кораблей с сервера
     */
    async function loadShipProjects() {
        if (Object.keys(shipProjectsCache).length === 0) {
            try {
                const fs = require('fs').promises;
                const path = require('path');

                const shipsDir = path.join(__dirname, '..', 'public', 'ships');
                const files = await fs.readdir(shipsDir);

                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const filePath = path.join(shipsDir, file);
                        const content = await fs.readFile(filePath, 'utf8');
                        const project = JSON.parse(content);
                        shipProjectsCache[project.id] = project;
                    }
                }

                console.log('Ship projects loaded on server:', Object.keys(shipProjectsCache));
            } catch (error) {
                console.error('Failed to load ship projects on server:', error);
            }
        }
        return shipProjectsCache;
    }

    /**
     * Получает проект корабля по ID
     */
    function getShipProject(projectId) {
        return shipProjectsCache[projectId] || null;
    }

    /**
     * Рассчитывает модифицированные характеристики корабля с учетом модулей
     */
    function calculateShipStats(shipClass, modules = []) {
        const project = Object.values(shipProjectsCache).find(p => p.class === shipClass);
        let baseStats = project || classStats[shipClass];

        // Создаем копию базовых характеристик
        const modifiedStats = { ...baseStats };

        // Применяем эффекты модулей
        modules.forEach(module => {
            if (module.effect.includes('+1 к скорости')) {
                modifiedStats.speed += 1;
            } else if (module.effect.includes('-1 к скорости')) {
                modifiedStats.speed -= 1;
            } else if (module.effect.includes('+1 к манёвренности')) {
                modifiedStats.maneuverability += 1;
            } else if (module.effect.includes('-1 к манёвренности')) {
                modifiedStats.maneuverability -= 1;
            } else if (module.effect.includes('+1 к броне')) {
                modifiedStats.armor += 1;
            } else if (module.effect.includes('-1 к броне')) {
                modifiedStats.armor -= 1;
            }
        });

        return modifiedStats;
    }

    /**
     * Рассчитывает характеристики движения корабля с учетом проекта и модулей
     */
    function calculateMovementStats(projectId, shipClass) {
        const project = getShipProject(projectId);

        // Используем данные из проекта или fallback на константы класса
        let baseStats = project || classStats[shipClass];
        let movementStats = shipMovementStats[shipClass];

        if (project && project.modules) {
            // Модифицируем характеристики движения на основе модулей
            const modifiedStats = calculateShipStats(shipClass, project.modules);

            // Пересчитываем характеристики движения на основе модифицированной скорости и манёвренности
            // Это простая логика, можно усложнить при необходимости
            movementStats = {
                baseMP: Math.max(1, modifiedStats.maneuverability),
                baseSP: Math.max(1, Math.floor(modifiedStats.speed / 2) + 1)
            };
        }

        return movementStats;
    }

    // Вспомогательные функции для кубических координат
    function cubeAdd(a, b) {
        return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
    }

    function cubeDistance(a, b) {
        return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
    }

    // Генерация пула кубиков
    function rollDicePool(numDice, previousOnes = 0) {
        const pool = { 1: previousOnes, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

        // Бросаем кубики
        for (let i = 0; i < numDice; i++) {
            const roll = Math.floor(Math.random() * 6) + 1;
            pool[roll]++;
        }

        console.log(`Rolled ${numDice} dice, got pool:`, pool);
        return pool;
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
     * Восстанавливает очки движения для всех кораблей игрока
     */
    function restoreMovementPoints(ships, playerId) {
        ships.forEach(ship => {
            if (ship.owner === playerId) {
                // Получаем актуальные характеристики с учетом проекта и модулей
                const project = getShipProject(ship.projectId);
                const stats = project ? calculateShipStats(ship.shipClass, project.modules || []) : classStats[ship.shipClass];

                ship.currentSpeed = stats.speed;
                ship.currentManeuverability = stats.maneuverability;
                ship.maxSpeed = stats.speed;
                ship.maxManeuverability = stats.maneuverability;

                console.log(`Restored movement points for ship ${ship.id}: Speed ${ship.currentSpeed}/${ship.maxSpeed}, Maneuverability ${ship.currentManeuverability}/${ship.maxManeuverability}`);
            }
        });
    }

    /**
     * Расчет доступных ходов для корабля с правильной логикой маневренности
     */
    function calculateMovementCells(ship, allShips) {
        const out = new Set();
        const seen = new Set();

        // Используем текущие очки движения корабля
        const currentSP = ship.currentSpeed || ship.maxSpeed || 0;
        const currentMP = ship.currentManeuverability || ship.maxManeuverability || 0;

        console.log(`Calculating movement for ship ${ship.id}: SP=${currentSP}, MP=${currentMP}`);

        // Ключ состояния: позиция, направление, SP, MP, количество последовательных поворотов
        const stateKey = (pos, dir, sp, mp, consecutiveTurns) => `${pos.q},${pos.r},${pos.s},${dir},${sp},${mp},${consecutiveTurns}`;

        const queue = [{
            position: ship.position,
            direction: ship.dir,
            sp: currentSP,  // Текущие очки скорости
            mp: currentMP,  // Текущие очки маневренности
            consecutiveTurns: 0  // Счетчик последовательных поворотов
        }];

        seen.add(stateKey(ship.position, ship.dir, currentSP, currentMP, 0));

        while (queue.length > 0) {
            const state = queue.shift();

            // Добавляем позицию в результат (кроме начальной)
            if (state.position.q !== ship.position.q ||
                state.position.r !== ship.position.r ||
                state.position.s !== ship.position.s) {
                out.add(`${state.position.q},${state.position.r},${state.position.s}`);
            }

            // Движение вперед (тратит 1 очко скорости, сбрасывает последовательные повороты)
            if (state.sp > 0) {
                const forwardDir = HEX_DIRECTIONS[state.direction];
                const newPos = cubeAdd(state.position, forwardDir);

                // Проверяем, не занята ли позиция другим кораблем
                const isOccupied = allShips.some(s =>
                    s.id !== ship.id &&
                    s.position.q === newPos.q &&
                    s.position.r === newPos.r &&
                    s.position.s === newPos.s
                );

                // Проверяем границы карты
                const outOfBounds = Math.abs(newPos.q) > 10 || Math.abs(newPos.r) > 10 || Math.abs(newPos.s) > 10;

                if (!isOccupied && !outOfBounds) {
                    const newStateKey = stateKey(newPos, state.direction, state.sp - 1, state.mp, 0);
                    if (!seen.has(newStateKey)) {
                        seen.add(newStateKey);
                        queue.push({
                            position: newPos,
                            direction: state.direction,
                            sp: state.sp - 1,
                            mp: state.mp,
                            consecutiveTurns: 0  // Движение сбрасывает последовательные повороты
                        });
                    }
                }
            }

            // Повороты (новая логика маневренности)
            if (state.mp > 0) {
                // Поворот на 60° (1 очко маневренности)
                if (state.consecutiveTurns === 0 || currentMP >= 2) {  // Можно поворачивать если это первый поворот или у нас достаточно маневренности
                    for (const turn of [-1, 1]) { // Лево и право
                        const newDir = (state.direction + (turn === -1 ? 1 : 5)) % 6;
                        const newStateKey = stateKey(state.position, newDir, state.sp, state.mp - 1, state.consecutiveTurns + 1);

                        if (!seen.has(newStateKey)) {
                            seen.add(newStateKey);
                            queue.push({
                                position: state.position,
                                direction: newDir,
                                sp: state.sp,
                                mp: state.mp - 1,
                                consecutiveTurns: state.consecutiveTurns + 1
                            });
                        }
                    }
                }

                // Поворот на 120° (2 очка маневренности)
                if (state.mp >= 2 && currentMP >= 2) {
                    for (const turn of [-2, 2]) {
                        const newDir = (state.direction + (turn === -2 ? 2 : 4)) % 6;
                        const newStateKey = stateKey(state.position, newDir, state.sp, state.mp - 2, 0);

                        if (!seen.has(newStateKey)) {
                            seen.add(newStateKey);
                            queue.push({
                                position: state.position,
                                direction: newDir,
                                sp: state.sp,
                                mp: state.mp - 2,
                                consecutiveTurns: 0  // 120° поворот не считается последовательным
                            });
                        }
                    }
                }

                // Поворот на 180° (3 очка маневренности)
                if (state.mp >= 3 && currentMP >= 3) {
                    const newDir = (state.direction + 3) % 6;
                    const newStateKey = stateKey(state.position, newDir, state.sp, state.mp - 3, 0);

                    if (!seen.has(newStateKey)) {
                        seen.add(newStateKey);
                        queue.push({
                            position: state.position,
                            direction: newDir,
                            sp: state.sp,
                            mp: state.mp - 3,
                            consecutiveTurns: 0  // 180° поворот не считается последовательным
                        });
                    }
                }
            }
        }

        // Конвертируем результат в массив координат
        const result = Array.from(out).map(posStr => {
            const [q, r, s] = posStr.split(',').map(Number);
            return { q, r, s };
        });

        console.log(`Movement calculation complete: ${result.length} available cells`);
        return result;
    }

    /**
     * Инициализация placement-фазы и раздача начального состояния
     */
    async function startBattle(roomId) {
        // Загружаем проекты кораблей перед началом боя
        await loadShipProjects();

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

        // 2) Случайный первый игрок для расстановки
        const firstPlacer = fleets[Math.floor(Math.random() * fleets.length)][0];

        // 3) Инициализируем пулы кубиков для каждого игрока (пустые в начале)
        const dicePools = {};
        fleets.forEach(([pid]) => {
            dicePools[pid] = {
                current: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, // Пустой пул в начале
                savedOnes: 0 // Сохраненные единицы с предыдущих раундов
            };
        });

        // 4) Формируем состояние в фазе placement
        room.battle.state = {
            id:               roomId,
            phase:            'placement',
            round:            0,  // "Нулевой" раунд расстановки
            currentPlayer:    firstPlacer,
            pendingPlacement: pendingPlacement,
            ships:            [],  // Корабли размещаются вручную
            map:              { width:11, height:11, obstacles:[] },
            dicePools:        dicePools,
            placementTurns:   0  // Счетчик ходов расстановки
        };
        room.battle.commands = {}; // пока не нужны

        // 5) Оповещаем оба клиента
        console.log('Sending battleState to clients:', room.battle.state);
        io.to(`battle_${roomId}`).emit('battleState', room.battle.state);
    }

    /**
     * Начало боевой фазы с генерацией кубиков
     */
    function startBattlePhase(roomId) {
        const room = rooms[roomId];
        const battleState = room.battle.state;

        // Переходим в боевую фазу
        battleState.phase = 'battle';
        battleState.round = 1;
        battleState.currentPlayer = room.players[0]; // Первый игрок начинает

        // Генерируем кубики для первого раунда
        room.players.forEach(pid => {
            const dicePool = rollDicePool(1, 0); // Первый раунд = 1 кубик
            battleState.dicePools[pid].current = dicePool;
            battleState.dicePools[pid].savedOnes = 0;
        });

        console.log('Battle phase started, round 1, dice pools:', battleState.dicePools);

        // Отправляем обновленное состояние с кубиками
        io.to(`battle_${roomId}`).emit('battleState', battleState);
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

    /**
     * Проверяет, доступна ли позиция для движения корабля
     */
    function isValidMovement(ship, targetPosition, allShips) {
        // Рассчитываем доступные ходы для этого корабля
        const availableCells = calculateMovementCells(ship, allShips);

        // Проверяем, есть ли целевая позиция среди доступных
        return availableCells.some(cell =>
            cell.q === targetPosition.q &&
            cell.r === targetPosition.r &&
            cell.s === targetPosition.s
        );
    }

    /**
     * Вычисляет направление движения корабля с отладочными логами
     */
    function getDirectionToTarget(from, to) {
        const diff = cubeAdd(to, { q: -from.q, r: -from.r, s: -from.s });

        console.log(`=== getDirectionToTarget DEBUG ===`);
        console.log(`From: (${from.q}, ${from.r}, ${from.s})`);
        console.log(`To: (${to.q}, ${to.r}, ${to.s})`);
        console.log(`Diff vector: (${diff.q}, ${diff.r}, ${diff.s})`);

        // Находим ближайшее направление
        let bestDir = 0;
        let bestDot = -2;

        for (let i = 0; i < 6; i++) {
            const dir = HEX_DIRECTIONS[i];
            const dot = diff.q * dir.q + diff.r * dir.r + diff.s * dir.s;

            console.log(`Direction ${i} (${dir.q}, ${dir.r}, ${dir.s}): dot product = ${dot}`);

            if (dot > bestDot) {
                bestDot = dot;
                bestDir = i;
                console.log(`  -> New best direction: ${i} with dot = ${dot}`);
            }
        }

        const directionNames = ['West', 'Northwest', 'Northeast', 'East', 'Southeast', 'Southwest'];
        console.log(`Final result: direction ${bestDir} (${directionNames[bestDir]}) with dot = ${bestDot}`);
        console.log(`=== END DEBUG ===`);

        return bestDir;
    }

    // Загружаем проекты кораблей при запуске сервера
    loadShipProjects();

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

            // Получаем проект корабля для правильных характеристик
            const project = getShipProject(projectId);
            const stats = project || classStats[item.shipClass];

            // Добавляем корабль на поле с правильными характеристиками
            const newShip = {
                id:        `${socket.id}_${projectId}_${Date.now()}`,
                owner:     socket.id,
                shipClass: item.shipClass,
                projectId,
                position,
                dir:       0,  // Направление корабля по умолчанию
                hp:        stats.activation, // Используем activation из проекта!
                modules:   project ? project.modules || [] : [],
                // Добавляем поля для текущих очков движения
                currentSpeed: stats.speed,
                currentManeuverability: stats.maneuverability,
                maxSpeed: stats.speed,
                maxManeuverability: stats.maneuverability
            };

            b.state.ships.push(newShip);
            console.log('Ship placed with correct stats:', newShip);

            // Разослать обновлённый state
            console.log('Sending updated battleState');
            io.to(`battle_${roomId}`).emit('battleState', b.state);
        });

        /**
         * Поворот корабля в фазе placement
         */
        socket.on('rotateShip', ({ roomId, shipId, direction }) => {
            console.log('rotateShip received:', { roomId, shipId, direction });

            const room = rooms[roomId];
            if (!room || !room.battle) {
                console.log('Room or battle not found');
                return;
            }

            const b = room.battle;
            if (b.state.phase !== 'placement') {
                console.log('Not in placement phase');
                return;
            }

            // Находим корабль
            const ship = b.state.ships.find(s => s.id === shipId);
            if (!ship) {
                console.log('Ship not found:', shipId);
                return;
            }

            // Проверяем, что это корабль игрока (убираем проверку текущего хода)
            if (ship.owner !== socket.id) {
                console.log('Not ship owner');
                return;
            }

            // Поворачиваем корабль
            if (direction === 'left') {
                ship.dir = (ship.dir + 1) % 6; // Поворот ВЛЕВО = увеличение направления
            } else if (direction === 'right') {
                ship.dir = (ship.dir + 5) % 6; // Поворот ВПРАВО = уменьшение направления (-1 с учетом модуля)
            }

            console.log(`Ship ${shipId} rotated to direction ${ship.dir}`);

            // Отправляем обновленное состояние
            io.to(`battle_${roomId}`).emit('battleState', b.state);
        });

        /**
         * Движение корабля в боевой фазе с тратой очков
         */
        socket.on('moveShip', ({ roomId, shipId, targetPosition }) => {
            console.log('moveShip received:', { roomId, shipId, targetPosition });

            const room = rooms[roomId];
            if (!room || !room.battle) {
                console.log('Room or battle not found');
                return;
            }

            const b = room.battle;
            if (b.state.phase !== 'battle') {
                console.log('Not in battle phase');
                return;
            }

            if (b.state.currentPlayer !== socket.id) {
                console.log('Not current player turn');
                return;
            }

            // Находим корабль
            const ship = b.state.ships.find(s => s.id === shipId);
            if (!ship) {
                console.log('Ship not found:', shipId);
                return;
            }

            // Проверяем, что это корабль игрока
            if (ship.owner !== socket.id) {
                console.log('Not ship owner');
                return;
            }

            // Проверяем, что позиция не занята
            const isOccupied = b.state.ships.some(s =>
                s.id !== shipId &&
                s.position.q === targetPosition.q &&
                s.position.r === targetPosition.r &&
                s.position.s === targetPosition.s
            );

            if (isOccupied) {
                console.log('Target position occupied');
                socket.emit('movementError', { message: 'Позиция занята' });
                return;
            }

            // Проверяем валидность движения
            if (!isValidMovement(ship, targetPosition, b.state.ships)) {
                console.log('Invalid movement - not reachable');
                socket.emit('movementError', { message: 'Недоступная позиция для движения' });
                return;
            }

            // Рассчитываем стоимость движения
            const distance = cubeDistance(ship.position, targetPosition);
            const requiredSpeed = distance;

            // Проверяем достаточность очков скорости
            if (ship.currentSpeed < requiredSpeed) {
                socket.emit('movementError', { message: 'Недостаточно очков скорости' });
                return;
            }

            // Вычисляем поворот и его стоимость
            let requiredManeuverability = 0;
            if (distance > 0) {
                const targetDirection = getDirectionToTarget(ship.position, targetPosition);
                const directionDiff = Math.abs(targetDirection - ship.dir);
                const actualDiff = Math.min(directionDiff, 6 - directionDiff); // Кратчайший поворот

                if (actualDiff === 1) requiredManeuverability = 1;      // 60°
                else if (actualDiff === 2) requiredManeuverability = 2; // 120°
                else if (actualDiff === 3) requiredManeuverability = 3; // 180°

                // Проверяем достаточность очков маневренности
                if (ship.currentManeuverability < requiredManeuverability) {
                    socket.emit('movementError', { message: 'Недостаточно очков маневренности для поворота' });
                    return;
                }

                // Поворачиваем корабль
                ship.dir = targetDirection;
            }

            // Обновляем позицию корабля
            const oldPosition = { ...ship.position };
            ship.position = targetPosition;

            // Тратим очки движения
            ship.currentSpeed -= requiredSpeed;
            ship.currentManeuverability -= requiredManeuverability;

            console.log(`Ship ${shipId} moved from (${oldPosition.q},${oldPosition.r},${oldPosition.s}) to (${targetPosition.q},${targetPosition.r},${targetPosition.s})`);
            console.log(`Movement cost: ${requiredSpeed} speed, ${requiredManeuverability} maneuverability`);
            console.log(`Remaining points: ${ship.currentSpeed}/${ship.maxSpeed} speed, ${ship.currentManeuverability}/${ship.maxManeuverability} maneuverability`);

            // Отправляем обновленное состояние
            io.to(`battle_${roomId}`).emit('battleState', b.state);
        });

        /**
         * Завершение хода в боевой фазе ИЛИ в фазе расстановки
         */
        socket.on('endTurn', ({ roomId }) => {
            console.log('=== END TURN EVENT RECEIVED ===');
            console.log('From player:', socket.id);
            console.log('For room:', roomId);
            console.log('Player nickname:', nicknames[socket.id]);

            const room = rooms[roomId];
            if (!room || !room.battle || !room.battle.state) {
                console.log('ERROR: Room or battle not found');
                return;
            }

            const battleState = room.battle.state;
            console.log('Current battle state:', {
                phase: battleState.phase,
                currentPlayer: battleState.currentPlayer,
                round: battleState.round
            });

            // Проверяем, что сейчас ход этого игрока
            if (battleState.currentPlayer !== socket.id) {
                console.log('ERROR: Not current player turn');
                console.log('Expected:', battleState.currentPlayer);
                console.log('Actual:', socket.id);
                socket.emit('turnError', { message: 'Сейчас не ваш ход' });
                return;
            }

            if (battleState.phase === 'placement') {
                // === ЛОГИКА ДЛЯ ФАЗЫ РАССТАНОВКИ ===
                console.log('Processing placement phase end turn');

                // Проверяем, что игрок разместил все свои корабли
                const pending = battleState.pendingPlacement[socket.id];
                if (pending && pending.length > 0) {
                    socket.emit('turnError', { message: 'Сначала разместите все корабли' });
                    return;
                }

                battleState.placementTurns++;

                if (battleState.placementTurns >= 2) {
                    // Оба игрока завершили расстановку - начинаем бой
                    console.log('Both players finished placement, starting battle');
                    startBattlePhase(roomId);
                    return;
                } else {
                    // Переключаемся на другого игрока
                    const otherPlayer = room.players.find(id => id !== socket.id);
                    battleState.currentPlayer = otherPlayer;
                    console.log(`Placement turn switched to ${nicknames[otherPlayer]}`);
                }

                // Отправляем обновленное состояние
                io.to(`battle_${roomId}`).emit('battleState', battleState);
                io.to(`battle_${roomId}`).emit('turnChanged', {
                    currentPlayer: battleState.currentPlayer,
                    currentPlayerNick: nicknames[battleState.currentPlayer],
                    round: battleState.round,
                    isNewRound: false
                });

            } else if (battleState.phase === 'battle') {
                // === ЛОГИКА ДЛЯ БОЕВОЙ ФАЗЫ ===
                console.log('Processing battle phase end turn');

                // Переключаем игрока
                const otherPlayer = room.players.find(id => id !== socket.id);
                console.log('Switching turn from', nicknames[socket.id], 'to', nicknames[otherPlayer]);

                battleState.currentPlayer = otherPlayer;

                // Восстанавливаем очки движения для нового активного игрока
                console.log('Restoring movement points for player:', nicknames[otherPlayer]);
                restoreMovementPoints(battleState.ships, otherPlayer);

                // Проверяем, нужно ли начать новый раунд
                const isNewRound = battleState.currentPlayer === room.players[0];

                if (isNewRound) {
                    battleState.round++;
                    console.log(`Starting round ${battleState.round}`);

                    // Генерируем новые пулы кубиков для нового раунда
                    room.players.forEach(pid => {
                        const playerDice = battleState.dicePools[pid];

                        // Сохраняем единицы из текущего пула
                        const savedOnes = playerDice.current[1] + playerDice.savedOnes;

                        // Генерируем новый пул кубиков
                        const newPool = rollDicePool(battleState.round, savedOnes);

                        playerDice.current = newPool;
                        playerDice.savedOnes = newPool[1]; // Обновляем счетчик сохраненных единиц

                        console.log(`Player ${nicknames[pid]} dice pool:`, newPool);
                    });
                }

                console.log('New battle state:', {
                    phase: battleState.phase,
                    currentPlayer: battleState.currentPlayer,
                    currentPlayerNick: nicknames[battleState.currentPlayer],
                    round: battleState.round
                });

                // Отправляем обновленное состояние
                console.log('Sending updated battleState to room:', `battle_${roomId}`);
                io.to(`battle_${roomId}`).emit('battleState', battleState);

                // Логируем смену хода
                io.to(`battle_${roomId}`).emit('turnChanged', {
                    currentPlayer: battleState.currentPlayer,
                    currentPlayerNick: nicknames[battleState.currentPlayer],
                    round: battleState.round,
                    isNewRound: isNewRound
                });

            } else {
                console.log('ERROR: Unknown phase:', battleState.phase);
                return;
            }

            console.log('=== END TURN EVENT COMPLETED ===');
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