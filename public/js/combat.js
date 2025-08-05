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

/**
 * Инициализация боевого модуля
 */
export function initCombatSystem(socket, playerId) {
    console.log('Combat system initialized');

    // Подписываемся на события
    setupCombatEventHandlers(socket);

    // Добавляем стили для боевых оверлеев
    addCombatStyles();
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

        case 'тестируем':
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
 * @param {Object} attackerPosition - Позиция атакующего на экране
 */
export function createWeaponSelectionOverlay(target, weapons, attackerPosition) {
    const svg = document.getElementById('hexmap');
    const rect = svg.getBoundingClientRect();

    // Конвертируем позицию цели в экранные координаты
    const targetElement = document.querySelector(`.ship-icon[data-ship-id="${target.id}"]`);
    if (!targetElement) return;

    const targetRect = targetElement.getBoundingClientRect();

    // Создаем оверлей
    const overlay = document.createElement('div');
    overlay.className = 'combat-overlay weapon-selection';
    overlay.style.left = `${targetRect.right + 10}px`;
    overlay.style.top = `${targetRect.top}px`;

    overlay.innerHTML = `
        <div class="overlay-header">
            <h4>🎯 ${target.shipClass}</h4>
            <span class="close-btn">&times;</span>
        </div>
        <div class="overlay-content">
            <div class="target-info">
                <span>HP: ${target.hp}/${target.maxHP || 5}</span>
                <span>Броня: ${target.armor || 5}</span>
            </div>
            <div class="weapons-list">
                ${weapons.map(weapon => `
                    <label class="weapon-option">
                        <input type="checkbox" data-weapon-id="${weapon.id}" data-target-id="${target.id}">
                        <span class="weapon-name">${weapon.name}</span>
                        <span class="weapon-stats">Урон: ${weapon.damage}, Дальность: ${weapon.range}</span>
                    </label>
                `).join('')}
            </div>
            <button class="fire-button" data-target-id="${target.id}">
                🔥 ОТКРЫТЬ ОГОНЬ
            </button>
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

    // Обработчики событий
    overlay.querySelector('.close-btn').onclick = () => {
        overlay.remove();
        clearCombatHighlights();
    };

    overlay.querySelector('.fire-button').onclick = () => {
        handleFireCommand(target.id);
        overlay.remove();
    };
}

/**
 * Обработка команды стрельбы
 * @param {string} targetId - ID цели
 */
function handleFireCommand(targetId) {
    const selectedWeapons = [];

    // Собираем выбранное оружие
    document.querySelectorAll(`input[data-target-id="${targetId}"]:checked`).forEach(checkbox => {
        selectedWeapons.push(checkbox.dataset.weaponId);
    });

    if (selectedWeapons.length === 0) {
        alert('Выберите хотя бы одно оружие!');
        return;
    }

    // Отправляем команду на сервер
    // TODO: Реализовать отправку через socket
    console.log('Fire command:', { targetId, weapons: selectedWeapons });

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
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #ef4444;
            border-radius: 2px;
            padding: 0;
            pointer-events: auto;
            min-width: 140px;
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
        }
        
        .overlay-header {
            background: #991b1b;
            padding: 10px 15px;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .overlay-header h4 {
            margin: 0;
            color: white;
            font-size: 10px;
        }
        
        .close-btn {
            color: white;
            font-size: 16px;
            cursor: pointer;
            line-height: 1;
        }
        
        .close-btn:hover {
            color: #fca5a5;
        }
        
        .overlay-content {
            padding: 8px;
        }
        
        .target-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            color: #fbbf24;
            font-size: 10px;
        }
        
        .weapons-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 15px;
        }
        
        .weapon-option {
            display: flex;
            align-items: center;
            padding: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .weapon-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .weapon-option input {
            margin-right: 8px;
        }
        
        .weapon-name {
            color: white;
            flex: 1;
        }
        
        .weapon-stats {
            color: #9ca3af;
            font-size: 12px;
        }
        
        .fire-button {
            width: 100%;
            padding: 10px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 16px;
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
    `;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'combat-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Тестовая функция для демонстрации боевой системы
 */
export function testCombatSystem(ship, allShips) {
    // Пример оружия
    const testWeapon = {
        id: 'main_guns',
        name: 'Главные орудия',
        damage: 2,
        range: 3,
        arc: 'standard'
    };

    // Подсветим дугу стрельбы
    highlightWeaponArc(ship, testWeapon);

    // Найдем цели
    const targets = findTargetsInArc(ship, testWeapon, allShips);

    if (targets.length > 0) {
        // Покажем оверлей для первой цели
        createWeaponSelectionOverlay(targets[0], [testWeapon], null);
    }

    console.log('Found targets:', targets);
}