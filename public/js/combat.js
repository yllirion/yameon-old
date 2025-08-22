// public/js/combat.js


/**
 * Модуль боевой системы
 * Отвечает за:
 * - Расчет зон стрельбы
 * - Выбор целей и оружия
 * - Обработку выстрелов
 * - Визуализацию боевых действий
 */


// Направления для кубических координат
const CUBE_DIRECTIONS = [
    { q: -1, r: 0, s: 1 },   // 0: West
    { q: 0, r: -1, s: 1 },   // 1: Northwest
    { q: 1, r: -1, s: 0 },   // 2: Northeast
    { q: 1, r: 0, s: -1 },   // 3: East
    { q: 0, r: 1, s: -1 },   // 4: Southeast
    { q: -1, r: 1, s: 0 }    // 5: Southwest
];

// Состояние боевой системы
let combatState = {
    mode: 'normal',  // 'normal', 'targeting', 'firing'
    selectedShip: null,
    targetingWeapon: null,
    availableTargets: [],
    weaponArcs: new Map() // Кеш зон стрельбы для оружия
};

let combatSocket = null;
let combatRoomId = null;
let lastBattleState = null;
let currentPlayerId = null;
let autoActivateShip = null;

// Функция для установки зависимостей
export function setCombatDependencies(battleState, playerId, activateFunc) {
    lastBattleState = battleState;
    currentPlayerId = playerId;
    autoActivateShip = activateFunc;
}

/**
 * Инициализация боевого модуля
 */
export function initCombatSystem(socket, playerId) {
    console.log('Combat system initialized');
    combatSocket = socket;

    // Подписываемся на события
    setupCombatEventHandlers(socket);

    // Добавляем стили для боевых оверлеев
    addCombatStyles();
}

export function setCombatRoomId(roomId) {
    combatRoomId = roomId;
}

/**
 * Расчет боевой дуги для оружия
 * @param {Object} ship - Корабль
 * @param {Object} weapon - Оружие
 * @returns {Array} Массив гексов в зоне поражения
 */
export function calculateWeaponArc(ship, weapon) {
    const cells = [];
    const { position, dir } = ship;
    const { range, arc } = weapon;

    // Основное направление корабля
    const mainDir = CUBE_DIRECTIONS[dir];
    const leftDir = CUBE_DIRECTIONS[(dir + 5) % 6];
    const rightDir = CUBE_DIRECTIONS[(dir + 1) % 6];

    // Расчет дуги в зависимости от типа
    switch (arc) {
        case 'narrow':
            // Узкая дуга - только прямо
            for (let dist = 1; dist <= range; dist++) {
                cells.push({
                    q: position.q + mainDir.q * dist,
                    r: position.r + mainDir.r * dist,
                    s: position.s + mainDir.s * dist
                });
            }
            break;

        case 'standard':
            // Стандартная дуга - конус вперед
            // Используем алгоритм из hex-game.js для более естественного конуса
            for (let t = 1; t <= range; t++) {
                // Центральная точка на расстоянии t
                const center = {
                    q: position.q + mainDir.q * t,
                    r: position.r + mainDir.r * t,
                    s: position.s + mainDir.s * t
                };
                cells.push(center);

                // Боковые точки - чем дальше от корабля, тем уже конус
                for (let i = 1; i <= range - t; i++) {
                    // Левая сторона конуса
                    cells.push({
                        q: center.q + leftDir.q * i,
                        r: center.r + leftDir.r * i,
                        s: center.s + leftDir.s * i
                    });
                    // Правая сторона конуса
                    cells.push({
                        q: center.q + rightDir.q * i,
                        r: center.r + rightDir.r * i,
                        s: center.s + rightDir.s * i
                    });
                }
            }
            break;

        case 'wide':
            // Широкая дуга - включает боковые направления
            // Прямо
            for (let dist = 1; dist <= range; dist++) {
                cells.push({
                    q: position.q + mainDir.q * dist,
                    r: position.r + mainDir.r * dist,
                    s: position.s + mainDir.s * dist
                });
            }
            // Левая сторона
            for (let dist = 1; dist <= Math.max(1, range - 1); dist++) {
                cells.push({
                    q: position.q + leftDir.q * dist,
                    r: position.r + leftDir.r * dist,
                    s: position.s + leftDir.s * dist
                });
            }
            // Правая сторона
            for (let dist = 1; dist <= Math.max(1, range - 1); dist++) {
                cells.push({
                    q: position.q + rightDir.q * dist,
                    r: position.r + rightDir.r * dist,
                    s: position.s + rightDir.s * dist
                });
            }
            break;

        case 'broadside':
            // Бортовой залп - стреляет в стороны
            for (let dist = 1; dist <= range; dist++) {
                cells.push({
                    q: position.q + leftDir.q * dist,
                    r: position.r + leftDir.r * dist,
                    s: position.s + leftDir.s * dist
                });
                cells.push({
                    q: position.q + rightDir.q * dist,
                    r: position.r + rightDir.r * dist,
                    s: position.s + rightDir.s * dist
                });
            }
            break;
    }

    return cells;
}

/**
 * Поиск целей в зоне поражения оружия
 * @param {Object} ship - Стреляющий корабль
 * @param {Object} weapon - Оружие
 * @param {Array} allShips - Все корабли на поле
 * @returns {Array} Массив доступных целей
 */
export function findTargetsInArc(ship, weapon, allShips) {
    const weaponCells = calculateWeaponArc(ship, weapon);
    const targets = [];

    allShips.forEach(target => {
        // Пропускаем свой корабль и союзников
        if (target.id === ship.id || target.owner === ship.owner) return;

        // Пропускаем уничтоженные корабли
        if (target.status === 'destroyed' || target.hp <= 0) return;

        // Проверяем, находится ли цель в зоне поражения
        const isInArc = weaponCells.some(cell =>
            cell.q === target.position.q &&
            cell.r === target.position.r &&
            cell.s === target.position.s
        );

        if (isInArc) {
            targets.push(target);
        }
    });

    return targets;
}

/**
 * Показать зону стрельбы на карте
 * @param {Object} ship - Корабль
 * @param {Object} weapon - Оружие
 */
export function highlightWeaponArc(ship, weapon) {
    clearCombatHighlights();

    const cells = calculateWeaponArc(ship, weapon);

    cells.forEach(cell => {
        const poly = document.querySelector(
            `#hexmap polygon[data-q="${cell.q}"][data-r="${cell.r}"][data-s="${cell.s}"]`
        );
        if (poly) {
            poly.classList.add('weapon-arc-highlight');
            poly.setAttribute('fill', 'rgba(239, 68, 68, 0.3)'); // Красноватый цвет
        }
    });
}

/**
 * Очистить боевые подсветки
 */
export function clearCombatHighlights() {
    document.querySelectorAll('.weapon-arc-highlight').forEach(poly => {
        poly.classList.remove('weapon-arc-highlight');
        poly.setAttribute('fill', '#dde');
    });
}

/**
 * Создать оверлей выбора оружия для цели
 * @param {Object} target - Корабль-цель
 * @param {Array} weapons - Доступное оружие
 * @param {Object} attacker - Атакующий корабль
 * @param {number} index - Индекс для смещения окна
 */
export function createWeaponSelectionOverlay(target, weapons, attacker, index = 0) {
    const svg = document.getElementById('hexmap');
    const rect = svg.getBoundingClientRect();

    // Конвертируем позицию цели в экранные координаты
    const targetElement = document.querySelector(`.ship-icon[data-ship-id="${target.id}"]`);
    if (!targetElement) return;

    const targetRect = targetElement.getBoundingClientRect();

    // Создаем оверлей
    const overlay = document.createElement('div');
    overlay.className = 'combat-overlay weapon-selection';

    // Смещаем окна чтобы они не накладывались
    const offsetX = 10 + (index % 2) * 250; // Чередуем слева и справа
    const offsetY = (Math.floor(index / 2)) * 150; // Смещаем вниз для следующих пар

    overlay.style.left = `${targetRect.right + offsetX}px`;
    overlay.style.top = `${targetRect.top + offsetY}px`;

    // Фильтруем только неиспользованное оружие
    const availableWeapons = weapons.filter(w =>
        !attacker.usedWeapons || !attacker.usedWeapons.includes(w.id)
    );

    overlay.innerHTML = `
        <div class="overlay-header">
            <h4>🎯 ${target.shipClass}</h4>
            <span class="overlay-drag-handle">⋮⋮</span>
            <span class="close-btn">&times;</span>
        </div>
        <div class="overlay-content">
            <div class="target-info">
                <div class="target-stats">
                    <span title="Очки жизни">❤️ ${target.hp}/${target.maxHP || 5}</span>
                    <span title="Броня">🛡️ ${target.armor || 5}</span>
                    <span title="Сложность = Скорость + Маневренность">🎯 ${(target.currentSpeed || 0) + (target.currentManeuverability || 0)}</span>
                </div>
            </div>
            <div class="weapons-list">
                ${availableWeapons.length > 0 ? availableWeapons.map(weapon => `
                    <label class="weapon-option ${weapon.arc}">
                        <input type="checkbox" data-weapon-id="${weapon.id}" data-target-id="${target.id}">
                        <div class="weapon-info">
                            <span class="weapon-name">${weapon.name}</span>
                            <span class="weapon-arc-icon" title="${weapon.arc}">${getArcIcon(weapon.arc)}</span>
                        </div>
                        <span class="weapon-stats">D${weapon.damage} R${weapon.range}</span>
                    </label>
                `).join('') : '<div class="no-weapons">Все орудия использованы</div>'}
            </div>
            ${availableWeapons.length > 0 ? `
                <button class="fire-button" data-target-id="${target.id}" data-attacker-id="${attacker.id}">
                    🔥 ОГОНЬ!
                </button>
            ` : ''}
        </div>
    `;

    // Добавляем в контейнер оверлеев
    let container = document.getElementById('combatOverlayContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'combatOverlayContainer';
        document.body.appendChild(container);
    }

    container.appendChild(overlay);

    // Делаем оверлей перетаскиваемым
    makeOverlayDraggable(overlay);

    // Обработчики событий
    overlay.querySelector('.close-btn').onclick = () => {
        overlay.remove();
        clearCombatHighlights();
    };

    const fireBtn = overlay.querySelector('.fire-button');
    if (fireBtn) {
        fireBtn.onclick = () => {
            handleFireCommand(target.id, attacker.id);
            overlay.remove();
        };
    }
}

/**
 * Получить иконку для типа дуги
 */
function getArcIcon(arc) {
    const icons = {
        'narrow': '▼',
        'standard': '◆',
        'wide': '◈',
        'broadside': '◄►'
    };
    return icons[arc] || '●';
}

/**
 * Сделать оверлей перетаскиваемым
 */
function makeOverlayDraggable(overlay) {
    const handle = overlay.querySelector('.overlay-drag-handle');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    handle.addEventListener('mousedown', dragStart);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === handle) {
            isDragging = true;
            overlay.style.cursor = 'move';
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        overlay.style.cursor = 'auto';
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            overlay.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }

    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
}

/**
 * Обработка команды стрельбы
 * @param {string} targetId - ID цели
 * @param {string} attackerId - ID атакующего
 */
function handleFireCommand(targetId, attackerId) {
    const selectedWeapons = [];

    // Собираем выбранное оружие
    document.querySelectorAll(`input[data-target-id="${targetId}"]:checked`).forEach(checkbox => {
        selectedWeapons.push(checkbox.dataset.weaponId);
    });

    if (selectedWeapons.length === 0) {
        alert('Выберите хотя бы одно оружие!');
        return;
    }

    // Проверяем что socket и roomId инициализированы
    if (!combatSocket || !combatRoomId) {
        console.error('Combat socket or roomId not initialized!');
        return;
    }

    // Автоактивация корабля если нужно
    const attacker = lastBattleState.ships.find(s => s.id === attackerId);
    if (attacker && attacker.status === 'ready') {
        if (!autoActivateShip(attackerId, combatRoomId, combatSocket)) {
            alert('Нет подходящих кубов для активации корабля!');
            return;
        }
        // Ждем немного чтобы активация прошла
        setTimeout(() => {
            combatSocket.emit('fireWeapons', {
                roomId: combatRoomId,
                attackerId: attackerId,
                targetId: targetId,
                weaponIds: selectedWeapons
            });
        }, 100);
    } else {
        // Корабль уже активирован - сразу стреляем
        combatSocket.emit('fireWeapons', {
            roomId: combatRoomId,
            attackerId: attackerId,
            targetId: targetId,
            weaponIds: selectedWeapons
        });
    }

    clearCombatHighlights();
}

/**
 * Настройка обработчиков событий
 */
function setupCombatEventHandlers(socket) {
    // Обработчик результатов стрельбы
    socket.on('combatResult', (data) => {
        console.log('Combat result:', data);
        // TODO: Показать анимацию попадания/промаха
    });

    // Обработчик урона
    socket.on('damageDealt', (data) => {
        console.log('Damage dealt:', data);
        // TODO: Обновить HP корабля
    });
}

/**
 * Добавление стилей для боевой системы
 */
function addCombatStyles() {
    if (document.getElementById('combat-styles')) return;

    const styles = `
        #combatOverlayContainer {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
        }
        
        .combat-overlay {
            position: absolute;
            background: rgba(20, 20, 20, 0.95);
            border: 2px solid #ef4444;
            border-radius: 6px;
            padding: 0;
            pointer-events: auto;
            width: 240px;
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
            font-size: 13px;
        }
        
        .overlay-header {
            background: #991b1b;
            padding: 6px 10px;
            border-radius: 4px 4px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: default;
        }
        
        .overlay-header h4 {
            margin: 0;
            color: white;
            font-size: 14px;
        }
        
        .overlay-drag-handle {
            color: rgba(255,255,255,0.6);
            cursor: move;
            padding: 0 8px;
            font-size: 16px;
            user-select: none;
        }
        
        .overlay-drag-handle:hover {
            color: white;
        }
        
        .close-btn {
            color: white;
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
        }
        
        .close-btn:hover {
            color: #fca5a5;
        }
        
        .overlay-content {
            padding: 10px;
        }
        
        .target-info {
            margin-bottom: 10px;
        }
        
        .target-stats {
            display: flex;
            justify-content: space-around;
            background: rgba(255,255,255,0.05);
            padding: 6px;
            border-radius: 4px;
        }
        
        .target-stats span {
            color: #fbbf24;
            font-size: 12px;
        }
        
        .weapons-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 10px;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .weapon-option {
            display: flex;
            align-items: center;
            padding: 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .weapon-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .weapon-option input {
            margin-right: 6px;
        }
        
        .weapon-info {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .weapon-name {
            color: white;
            font-size: 12px;
        }
        
        .weapon-arc-icon {
            color: #9ca3af;
            font-size: 14px;
        }
        
        .weapon-stats {
            color: #9ca3af;
            font-size: 11px;
        }
        
        .no-weapons {
            text-align: center;
            color: #6b7280;
            padding: 20px;
            font-style: italic;
        }
        
        .fire-button {
            width: 100%;
            padding: 8px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .fire-button:hover {
            background: #ef4444;
        }
        
        .weapon-arc-highlight {
            animation: pulse-red 1.5s infinite;
        }
        
        @keyframes pulse-red {
            0% { opacity: 0.3; }
            50% { opacity: 0.6; }
            100% { opacity: 0.3; }
        }
        
        /* Стили для результатов боя */
        .combat-result-overlay {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #fbbf24;
            border-radius: 8px;
            padding: 20px;
            min-width: 300px;
            max-width: 500px;
            z-index: 1100;
        }
        
        .combat-result-header {
            font-size: 18px;
            font-weight: bold;
            color: #fbbf24;
            margin-bottom: 15px;
            text-align: center;
        }
        
        .combat-step {
            background: rgba(255,255,255,0.05);
            padding: 10px;
            margin: 5px 0;
            border-radius: 4px;
        }
        
        .combat-step.hit {
            border-left: 3px solid #4CAF50;
        }
        
        .combat-step.miss {
            border-left: 3px solid #F44336;
        }
        
        .combat-step.critical {
            border-left: 3px solid #fbbf24;
            animation: pulse-gold 2s infinite;
        }
        
        @keyframes pulse-gold {
            0% { box-shadow: 0 0 5px rgba(251, 191, 36, 0.5); }
            50% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.8); }
            100% { box-shadow: 0 0 5px rgba(251, 191, 36, 0.5); }
        }
    `;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'combat-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Закрыть все боевые оверлеи
 */
export function closeAllCombatOverlays() {
    const overlays = document.querySelectorAll('.combat-overlay');
    overlays.forEach(overlay => overlay.remove());
    clearCombatHighlights();
}

/**
 * Тестовая функция для демонстрации боевой системы
 */
export function testCombatSystem(ship, allShips) {
    // Закрываем предыдущие оверлеи
    closeAllCombatOverlays();

    // Получаем оружие корабля
    const weapons = getShipWeapons(ship);

    // Собираем все ячейки из всех дуг
    const allWeaponCells = new Set();

    weapons.forEach(weapon => {
        const cells = calculateWeaponArc(ship, weapon);
        cells.forEach(cell => {
            allWeaponCells.add(`${cell.q},${cell.r},${cell.s}`);
        });
    });

    // Подсвечиваем объединенную зону
    clearCombatHighlights();
    allWeaponCells.forEach(cellKey => {
        const [q, r, s] = cellKey.split(',').map(Number);
        const poly = document.querySelector(
            `#hexmap polygon[data-q="${q}"][data-r="${r}"][data-s="${s}"]`
        );
        if (poly) {
            poly.classList.add('weapon-arc-highlight');
            poly.setAttribute('fill', 'rgba(239, 68, 68, 0.3)');
        }
    });

    // Находим все цели в пределах досягаемости любого оружия
    const potentialTargets = new Set();

    weapons.forEach(weapon => {
        // Найдем цели для этого оружия
        const targets = findTargetsInArc(ship, weapon, allShips);
        targets.forEach(t => potentialTargets.add(t));
    });

    // Конвертируем Set в массив
    const allTargets = Array.from(potentialTargets);

    // Создаем оверлей для КАЖДОЙ цели
    allTargets.forEach((target, index) => {
        // Задержка для распределения окон
        setTimeout(() => {
            createWeaponSelectionOverlay(target, weapons, ship, index);
        }, index * 50); // Небольшая задержка чтобы окна не накладывались
    });

    console.log('Found targets:', allTargets);
}

/**
 * Получить оружие корабля (временная реализация)
 */
function getShipWeapons(ship) {
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
