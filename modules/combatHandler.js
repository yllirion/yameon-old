// modules/combatHandler.js

/**
 * Модуль обработки боевых действий на сервере
 */

// Таблица критических попаданий
const CRIT_TABLE = {
    2: { type: 'reactor_explosion', damage: 1, effect: 'Реактор взрывается' },
    3: { type: 'chain_reaction', damage: 1, effect: 'Цепная реакция' },
    4: { type: 'armor_damage', damage: 1, effect: 'Броня -1' },
    5: { type: 'speed_damage', damage: 1, effect: 'Скорость -1' },
    6: { type: 'maneuver_damage', damage: 1, effect: 'Маневренность -1' },
    7: { type: 'no_effect', damage: 1, effect: 'Без эффекта' },
    8: { type: 'armor_damage', damage: 1, effect: 'Броня -1' },
    9: { type: 'speed_damage', damage: 1, effect: 'Скорость -1' },
    10: { type: 'maneuver_damage', damage: 1, effect: 'Маневренность -1' },
    11: { type: 'chain_reaction', damage: 1, effect: 'Цепная реакция' },
    12: { type: 'bridge_hit', damage: 999, effect: 'Попадание в командную рубку' }
};

/**
 * Бросок 2d6
 */
function roll2d6() {
    return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

/**
 * Рассчитать сложность цели
 */
function calculateTargetDifficulty(target) {
    const speed = target.currentSpeed || 0;
    const maneuver = target.currentManeuverability || 0;
    return speed + maneuver;
}

/**
 * Получить текущую броню с учетом повреждений
 */
function getCurrentArmor(ship, baseArmor) {
    // Если на корабле есть модификатор брони от повреждений
    const armorPenalty = ship.armorPenalty || 0;
    return Math.max(0, baseArmor - armorPenalty);
}

/**
 * Проверка попадания
 */
function checkHit(targetDifficulty) {
    const roll = roll2d6();
    return {
        success: roll > targetDifficulty,
        roll: roll,
        needed: targetDifficulty
    };
}

/**
 * Проверка пробития брони
 */
function checkArmorPenetration(armorValue) {
    const roll = roll2d6();
    return {
        success: roll > armorValue,
        roll: roll,
        needed: armorValue
    };
}

/**
 * Обработка критического попадания
 */
function processCriticalHit(target, battleState, io, roomId) {
    const roll = roll2d6();
    const crit = CRIT_TABLE[roll];

    const result = {
        roll: roll,
        type: crit.type,
        effect: crit.effect,
        damage: crit.damage,
        additionalEffects: []
    };

    // Применяем урон
    target.hp -= crit.damage;

    // Обрабатываем эффекты
    switch (crit.type) {
        case 'reactor_explosion':
            result.additionalEffects.push('Взрыв реактора!');
            // Уничтожаем корабль
            target.hp = 0;
            target.status = 'destroyed';

            // Наносим урон всем в радиусе
            const explosionRadius = Math.max(1, target.activation - 1);
            const nearbyShips = findShipsInRadius(target, battleState.ships, explosionRadius);

            nearbyShips.forEach(ship => {
                const armorCheck = checkArmorPenetration(getCurrentArmor(ship, ship.armor || 5));
                if (!armorCheck.success) {
                    ship.hp -= 1;
                    result.additionalEffects.push(`${ship.shipClass} получил урон от взрыва`);

                    if (ship.hp <= 0) {
                        ship.status = 'destroyed';
                    }
                }
            });
            break;

        case 'chain_reaction':
            result.additionalEffects.push('Цепная реакция!');
            const chainResult = processCriticalHit(target, battleState, io, roomId);
            // Более наглядное форматирование
            result.additionalEffects.push(`→ ${chainResult.effect} (бросок: ${chainResult.roll})`);
            // Добавляем вложенные эффекты с отступом
            if (chainResult.additionalEffects) {
                chainResult.additionalEffects.forEach(eff => {
                    result.additionalEffects.push(`  ${eff}`);
                });
            }
/*
            result.additionalEffects.push('Цепная реакция!');
            // Рекурсивно вызываем еще один крит
            setTimeout(() => {
                const chainResult = processCriticalHit(target, battleState, io, roomId);
                io.to(`battle_${roomId}`).emit('chainReaction', {
                    targetId: target.id,
                    result: chainResult
                });
            }, 1000);
*/
            break;

        case 'armor_damage':
            target.armorPenalty = (target.armorPenalty || 0) + 1;
            result.additionalEffects.push('Броня повреждена');
            break;

        case 'speed_damage':
            target.currentSpeed = Math.max(0, target.currentSpeed - 1);
            target.maxSpeed = Math.max(0, target.maxSpeed - 1);
            result.additionalEffects.push('Двигатели повреждены');
            break;

        case 'maneuver_damage':
            target.currentManeuverability = Math.max(0, target.currentManeuverability - 1);
            target.maxManeuverability = Math.max(0, target.maxManeuverability - 1);
            result.additionalEffects.push('Рулевое управление повреждено');
            break;

        case 'bridge_hit':
            target.hp = 0;
            target.status = 'destroyed';
            result.additionalEffects.push('Прямое попадание в мостик!');
            break;
    }

    // Проверяем уничтожение
    if (target.hp <= 0) {
        target.status = 'destroyed';
        result.additionalEffects.push(`${target.shipClass} уничтожен!`);
    }

    return result;
}

/**
 * Найти корабли в радиусе от цели
 */
function findShipsInRadius(center, allShips, radius) {
    return allShips.filter(ship => {
        if (ship.id === center.id || ship.status === 'destroyed') return false;

        const distance = Math.abs(ship.position.q - center.position.q) +
            Math.abs(ship.position.r - center.position.r) +
            Math.abs(ship.position.s - center.position.s);

        return distance / 2 <= radius;
    });
}

/**
 * Основная функция обработки выстрела
 */
function processWeaponFire(attacker, target, weapon, battleState, io, roomId) {
    const results = {
        weaponId: weapon.id,
        weaponName: weapon.name,
        attackerId: attacker.id,
        targetId: target.id,
        steps: []
    };

    if (!attacker.usedWeapons) {
        attacker.usedWeapons = [];
    }
    attacker.usedWeapons.push(weapon.id);

    // 1. Проверка попадания
    const difficulty = calculateTargetDifficulty(target);
    const hitCheck = checkHit(difficulty);

    results.steps.push({
        type: 'hit_check',
        roll: hitCheck.roll,
        needed: hitCheck.needed,
        success: hitCheck.success,
        message: `Проверка попадания: ${hitCheck.roll} vs ${hitCheck.needed} (Сл=${target.currentSpeed}+Мн=${target.currentManeuverability})`
    });

    if (!hitCheck.success) {
        results.result = 'miss';
        results.message = 'Промах!';
        return results;
    }

    // 2. Проверка брони
    const currentArmor = getCurrentArmor(target, target.armor || 5);
    const armorCheck = checkArmorPenetration(currentArmor);

    results.steps.push({
        type: 'armor_check',
        roll: armorCheck.roll,
        needed: armorCheck.needed,
        success: armorCheck.success,
        message: `Проверка брони: ${armorCheck.roll} vs ${armorCheck.needed}`
    });

    if (!armorCheck.success) {
        results.result = 'deflected';
        results.message = 'Броня выдержала попадание!';
        return results;
    }

    // 3. Критическое попадание
    const critResult = processCriticalHit(target, battleState, io, roomId);

    results.steps.push({
        type: 'critical_hit',
        roll: critResult.roll,
        effect: critResult.effect,
        damage: critResult.damage,
        message: `Критическое попадание: ${critResult.roll} - ${critResult.effect}`
    });

    results.result = 'hit';
    results.damage = critResult.damage;
    results.criticalEffect = critResult.effect;
    results.additionalEffects = critResult.additionalEffects;
    results.targetDestroyed = target.hp <= 0;

    // Отмечаем что оружие использовано

    return results;
}

/**
 * Обработчик команды стрельбы
 */
function handleFireCommand(socket, roomId, data, rooms, nicknames, io, broadcastRoomsData) {
    const { attackerId, targetId, weaponIds } = data;

    const room = rooms[roomId];
    if (!room || !room.battle || !room.battle.state) {
        socket.emit('combatError', { message: 'Битва не найдена' });
        return;
    }

    const battleState = room.battle.state;

    // Проверки
    const attacker = battleState.ships.find(s => s.id === attackerId);
    const target = battleState.ships.find(s => s.id === targetId);

    if (!attacker || !target) {
        socket.emit('combatError', { message: 'Корабль не найден' });
        return;
    }

    if (attacker.owner !== socket.id) {
        socket.emit('combatError', { message: 'Это не ваш корабль' });
        return;
    }

    if (attacker.status !== 'activated') {
        socket.emit('combatError', { message: 'Корабль не активирован' });
        return;
    }

    // Получаем оружие корабля (пока заглушка)
    const availableWeapons = getShipWeapons(attacker);

    const results = [];

    weaponIds.forEach(weaponId => {
        const weapon = availableWeapons.find(w => w.id === weaponId);
        if (!weapon) return;

        // Проверяем, не использовано ли оружие
        if (attacker.usedWeapons && attacker.usedWeapons.includes(weaponId)) {
            results.push({
                weaponId: weaponId,
                error: 'Оружие уже использовано в этом ходу'
            });
            return;
        }

        // Обрабатываем выстрел
        const fireResult = processWeaponFire(attacker, target, weapon, battleState, io, roomId);
        results.push(fireResult);
    });

    // Отправляем результаты
    io.to(`battle_${roomId}`).emit('combatResults', {
        attackerId: attackerId,
        targetId: targetId,
        results: results,
        timestamp: Date.now()
    });

    // Обновляем состояние битвы
    io.to(`battle_${roomId}`).emit('battleState', battleState);

    checkVictoryConditions(battleState, rooms[roomId], io, roomId, nicknames, rooms, broadcastRoomsData);
}

/**
 * Временная функция получения оружия корабля
 */
function getShipWeapons(ship) {
    // TODO: Загружать из конфигурации проекта корабля
    const weaponsByClass = {
        'Фрегат': [
            { id: 'frigate_gun_1', name: 'Легкое орудие', damage: 1, range: 3, arc: 'standard' }
        ],
        'Эсминец': [
            { id: 'destroyer_gun_1', name: 'Орудие ГК', damage: 2, range: 4, arc: 'standard' },
            { id: 'destroyer_gun_2', name: 'Зенитка', damage: 1, range: 2, arc: 'wide' }
        ],
        'Крейсер': [
            { id: 'cruiser_gun_1', name: 'Тяжелое орудие #1', damage: 2, range: 4, arc: 'narrow' },
            { id: 'cruiser_gun_2', name: 'Тяжелое орудие #2', damage: 2, range: 4, arc: 'narrow' },
            { id: 'cruiser_sec_1', name: 'Вспомогательное #1', damage: 1, range: 3, arc: 'wide' }
        ],
        'Линкор': [
            { id: 'battleship_main_1', name: 'Главный калибр #1', damage: 3, range: 5, arc: 'narrow' },
            { id: 'battleship_main_2', name: 'Главный калибр #2', damage: 3, range: 5, arc: 'narrow' },
            { id: 'battleship_sec_1', name: 'Средний калибр #1', damage: 2, range: 4, arc: 'wide' },
            { id: 'battleship_sec_2', name: 'Средний калибр #2', damage: 2, range: 4, arc: 'wide' }
        ],
        'Дредноут': [
            { id: 'dread_main_1', name: 'Сверхтяжелое орудие #1', damage: 4, range: 6, arc: 'narrow' },
            { id: 'dread_main_2', name: 'Сверхтяжелое орудие #2', damage: 4, range: 6, arc: 'narrow' },
            { id: 'dread_main_3', name: 'Сверхтяжелое орудие #3', damage: 4, range: 6, arc: 'narrow' }
        ]
    };

    return weaponsByClass[ship.shipClass] || [];
}

function checkVictoryConditions(battleState, room, io, roomId, nicknames, rooms, broadcastRoomsData) {
    // Подсчитываем живые корабли каждого игрока
    const aliveShipsByPlayer = {};

    battleState.ships.forEach(ship => {
        if (ship.hp > 0 && ship.status !== 'destroyed') {
            aliveShipsByPlayer[ship.owner] = (aliveShipsByPlayer[ship.owner] || 0) + 1;
        }
    });

    // Проверяем, остался ли кто-то без кораблей
    const players = room.players;
    const losers = players.filter(playerId => !aliveShipsByPlayer[playerId]);

    if (losers.length > 0) {
        // Кто-то проиграл
        const winners = players.filter(playerId => aliveShipsByPlayer[playerId] > 0);

        io.to(`battle_${roomId}`).emit('gameOver', {
            winners: winners.map(id => nicknames[id]),
            losers: losers.map(id => nicknames[id]),
            reason: 'Все корабли уничтожены'
        });

        // Удаляем комнату как при сдаче
        delete rooms[roomId];
        broadcastRoomsData();
    }
}

module.exports = {
    handleFireCommand,
    getShipWeapons
};