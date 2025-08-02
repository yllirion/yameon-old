// public/js/hexmap.js

export const HEX_SIZE = 20;
export const GRID_W   = 20;
export const GRID_H   = 20;

let selectedHex = null;
let selectedShipForRotation = null; // Корабль, выбранный для поворота
let selectedShipForMovement = null; // Корабль, выбранный для движения
let movementCells = []; // Доступные гексы для движения

// Направления для кубических координат (соответствуют HEX_DIRECTIONS)
const CUBE_DIRECTIONS = [
    { q: -1, r: 0, s: 1 },   // 0: West
    { q: 0, r: -1, s: 1 },   // 1: Northwest
    { q: 1, r: -1, s: 0 },   // 2: Northeast
    { q: 1, r: 0, s: -1 },   // 3: East
    { q: 0, r: 1, s: -1 },   // 4: Southeast
    { q: -1, r: 1, s: 0 }    // 5: Southwest
];

// Направления в гексагональной сетке (в радианах)
// Соответствуют кубическим координатам: West, NW, NE, East, SE, SW
const HEX_DIRECTIONS = [
    Math.PI,             // 0: West (лево, 180°)
    2 * Math.PI / 3,     // 1: Northwest (верх-лево, 120°)
    Math.PI / 3,         // 2: Northeast (верх-право, 60°)
    0,                   // 3: East (право, 0°)
    5 * Math.PI / 3,     // 4: Southeast (низ-право, 300°)
    4 * Math.PI / 3      // 5: Southwest (низ-лево, 240°)
];

// Базовые характеристики кораблей для расчета движения
const SHIP_STATS = {
    'Фрегат':   { baseMP: 1, baseSP: 3 },
    'Эсминец':  { baseMP: 1, baseSP: 3 },
    'Крейсер':  { baseMP: 1, baseSP: 2 },
    'Линкор':   { baseMP: 1, baseSP: 2 },
    'Дредноут': { baseMP: 1, baseSP: 1 }
};

// Маппинг классов кораблей на английские названия для файлов
const shipClassToIcon = {
    'Фрегат': 'frigate',
    'Эсминец': 'destroyer',
    'Крейсер': 'cruiser',
    'Линкор': 'battleship',
    'Дредноут': 'dreadnought'
};

// Цвета для fallback, если нет иконок
const shipClassColors = {
    'Фрегат': '#4CAF50',   // зеленый
    'Эсминец': '#2196F3',  // синий
    'Крейсер': '#FF9800',  // оранжевый
    'Линкор': '#F44336',   // красный
    'Дредноут': '#9C27B0'  // фиолетовый
};

/** Вспомогательные функции для кубических координат */
function cubeAdd(a, b) {
    return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
}

function cubeDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

/** Рисует pointy-top гекс-карту в <svg id="hexmap"> */
export function drawHexGrid() {
    const svg = document.getElementById('hexmap');
    if (!svg) {
        console.error('SVG element #hexmap not found');
        return;
    }

    const w   = svg.clientWidth;
    const h   = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));
    svg.innerHTML = '';

    for (let col = 0; col < GRID_W; col++) {
        for (let row = 0; row < GRID_H; row++) {
            const q = col - Math.floor(GRID_W / 2);
            const r = row - Math.floor(GRID_H / 2);
            const s = -q - r;
            const hex = Hex(q, r, s);
            const pts = polygon_corners(layout, hex)
                .map(p => `${p.x},${p.y}`)
                .join(' ');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts);
            poly.setAttribute('stroke', '#333');
            poly.setAttribute('fill', '#dde');
            poly.setAttribute('stroke-width', '1');

            // Добавляем data-атрибуты для координат
            poly.setAttribute('data-q', q);
            poly.setAttribute('data-r', r);
            poly.setAttribute('data-s', s);

            // Добавляем hover эффект
            poly.addEventListener('mouseenter', () => {
                if (poly !== selectedHex) {
                    poly.setAttribute('fill', '#ccf');
                }
            });
            poly.addEventListener('mouseleave', () => {
                if (poly !== selectedHex) {
                    poly.setAttribute('fill', '#dde');
                }
            });

            svg.appendChild(poly);
        }
    }

    console.log('Hex grid drawn successfully');
}

function onHexClick(evt) {
    if (selectedHex) selectedHex.setAttribute('fill', '#dde');
    selectedHex = evt.currentTarget;
    selectedHex.setAttribute('fill', '#cfc');
}

/** Рисует все выставленные корабли как SVG элементы */
export function renderPlacedShips(ships) {
    console.log('Rendering ships:', ships);

    // Удаляем предыдущие иконки и кнопки
    document.querySelectorAll('.ship-icon, .ship-rotation-controls').forEach(el => el.remove());

    const svg = document.getElementById('hexmap');
    if (!svg) {
        console.error('SVG element not found');
        return;
    }

    const w   = svg.clientWidth;
    const h   = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));

    ships.forEach(ship => {
        const hex = Hex(ship.position.q, ship.position.r, ship.position.s);
        const { x, y } = hex_to_pixel(layout, hex);

        // Получаем угол поворота из направления корабля
        const rotation = HEX_DIRECTIONS[ship.dir || 0];

        // Попробуем сначала картинку
        const iconName = shipClassToIcon[ship.shipClass] || 'unknown';
        const iconPath = `/icons/${iconName}.png`;

        // Создаем группу для корабля
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('ship-icon');
        group.setAttribute('data-ship-id', ship.id);

        // Создаем элемент изображения
        const img = document.createElementNS('http://www.w3.org/2000/svg','image');
        img.setAttribute('href', iconPath);
        img.setAttribute('width', HEX_SIZE * 1.5);
        img.setAttribute('height', HEX_SIZE * 1.5);
        img.setAttribute('x', -HEX_SIZE * 0.75);
        img.setAttribute('y', -HEX_SIZE * 0.75);

        // Применяем поворот к группе
        // Добавляем 90 градусов, чтобы корабль по умолчанию смотрел на грань, а не в угол
        const rotationDegrees = (rotation * 180 / Math.PI) + 90;
        group.setAttribute('transform', `translate(${x}, ${y}) rotate(${rotationDegrees})`);

        // Fallback: если картинка не загрузилась, показываем цветной треугольник
        img.onerror = () => {
            console.log(`Icon not found: ${iconPath}, using fallback`);
            img.remove();

            // Создаем треугольник, указывающий направление
            const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const size = HEX_SIZE * 0.8;
            triangle.setAttribute('points', `${size},0 ${-size/2},${size/2} ${-size/2},${-size/2}`);
            triangle.setAttribute('fill', shipClassColors[ship.shipClass] || '#666');
            triangle.setAttribute('stroke', '#000');
            triangle.setAttribute('stroke-width', '2');

            // Добавляем текст с первой буквой класса
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', -size/3);
            text.setAttribute('y', 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '10');
            text.setAttribute('fill', '#fff');
            text.setAttribute('font-weight', 'bold');
            text.textContent = ship.shipClass.charAt(0);

            group.appendChild(triangle);
            group.appendChild(text);
        };

        img.onload = () => {
            console.log(`Icon loaded successfully: ${iconPath}`);
        };

        group.appendChild(img);
        svg.appendChild(group);
    });

    console.log(`Rendered ${ships.length} ships on the map`);
}

/** Добавляет кнопки поворота под кораблем */
export function addRotationControls(ship, isCurrentPlayer, isPlacementPhase, onRotate) {
    // В фазе расстановки показываем кнопки для всех своих кораблей
    if (!isCurrentPlayer || !isPlacementPhase) return;

    const svg = document.getElementById('hexmap');
    if (!svg) return;

    const w = svg.clientWidth;
    const h = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));

    const hex = Hex(ship.position.q, ship.position.r, ship.position.s);
    const { x, y } = hex_to_pixel(layout, hex);

    // Создаем группу для кнопок
    const controlGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    controlGroup.classList.add('ship-rotation-controls');
    controlGroup.setAttribute('data-ship-id', ship.id);
    controlGroup.style.display = 'none'; // Скрываем по умолчанию

    // Кнопка поворота влево
    const leftButton = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    leftButton.classList.add('rotation-button');
    leftButton.style.cursor = 'pointer';

    const leftCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    leftCircle.setAttribute('cx', x - 20);
    leftCircle.setAttribute('cy', y + HEX_SIZE + 15);
    leftCircle.setAttribute('r', 12); // Увеличено с 8 до 12
    leftCircle.setAttribute('fill', '#2196F3');
    leftCircle.setAttribute('stroke', '#fff');
    leftCircle.setAttribute('stroke-width', 2);

    const leftText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    leftText.setAttribute('x', x - 20);
    leftText.setAttribute('y', y + HEX_SIZE + 20); // Скорректировано под новый размер
    leftText.setAttribute('text-anchor', 'middle');
    leftText.setAttribute('font-size', '14'); // Увеличено с 10 до 14
    leftText.setAttribute('font-weight', 'bold');
    leftText.setAttribute('fill', '#fff');
    leftText.textContent = 'L';

    leftButton.appendChild(leftCircle);
    leftButton.appendChild(leftText);

    // Кнопка поворота вправо
    const rightButton = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    rightButton.classList.add('rotation-button');
    rightButton.style.cursor = 'pointer';

    const rightCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rightCircle.setAttribute('cx', x + 20);
    rightCircle.setAttribute('cy', y + HEX_SIZE + 15);
    rightCircle.setAttribute('r', 12); // Увеличено с 8 до 12
    rightCircle.setAttribute('fill', '#2196F3');
    rightCircle.setAttribute('stroke', '#fff');
    rightCircle.setAttribute('stroke-width', 2);

    const rightText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rightText.setAttribute('x', x + 20);
    rightText.setAttribute('y', y + HEX_SIZE + 20); // Скорректировано под новый размер
    rightText.setAttribute('text-anchor', 'middle');
    rightText.setAttribute('font-size', '14'); // Увеличено с 10 до 14
    rightText.setAttribute('font-weight', 'bold');
    rightText.setAttribute('fill', '#fff');
    rightText.textContent = 'R';

    rightButton.appendChild(rightCircle);
    rightButton.appendChild(rightText);

    // Обработчики событий
    leftButton.onclick = (e) => {
        e.stopPropagation();
        onRotate(ship.id, 'left');
    };

    rightButton.onclick = (e) => {
        e.stopPropagation();
        onRotate(ship.id, 'right');
    };

    controlGroup.appendChild(leftButton);
    controlGroup.appendChild(rightButton);
    svg.appendChild(controlGroup);

    console.log('Rotation controls added for ship:', ship.id);
}

/** Расчет доступных ходов для корабля (BFS алгоритм) */
function calculateMovementCells(ship, allShips) {
    const stats = SHIP_STATS[ship.shipClass] || { baseMP: 1, baseSP: 3 };
    const out = new Set();
    const seen = new Set();

    // Ключ состояния: позиция, направление, SP, MP, последний поворот
    const stateKey = (pos, dir, sp, mp, lastTurn) => `${pos.q},${pos.r},${pos.s},${dir},${sp},${mp},${lastTurn}`;

    const queue = [{
        position: ship.position,
        direction: ship.dir,
        sp: stats.baseSP,  // Speed points
        mp: stats.baseMP,  // Maneuver points
        lastTurn: false    // Был ли поворот на последнем шаге
    }];

    seen.add(stateKey(ship.position, ship.dir, stats.baseSP, stats.baseMP, false));

    while (queue.length > 0) {
        const state = queue.shift();

        // Добавляем позицию в результат (кроме начальной)
        if (state.position !== ship.position) {
            out.add(`${state.position.q},${state.position.r},${state.position.s}`);
        }

        // Движение вперед
        if (state.sp > 0) {
            const forwardDir = CUBE_DIRECTIONS[state.direction];
            const newPos = cubeAdd(state.position, forwardDir);

            // Проверяем, не занята ли позиция другим кораблем
            const isOccupied = allShips.some(s =>
                s.id !== ship.id &&
                s.position.q === newPos.q &&
                s.position.r === newPos.r &&
                s.position.s === newPos.s
            );

            if (!isOccupied) {
                const newStateKey = stateKey(newPos, state.direction, state.sp - 1, state.mp, false);
                if (!seen.has(newStateKey)) {
                    seen.add(newStateKey);
                    queue.push({
                        position: newPos,
                        direction: state.direction,
                        sp: state.sp - 1,
                        mp: state.mp,
                        lastTurn: false
                    });
                }
            }
        }

        // Повороты (если есть MP и не поворачивались на последнем шаге)
        if (state.mp > 0 && !state.lastTurn) {
            for (const turn of [-1, 1]) { // Лево и право
                const newDir = (state.direction + (turn === -1 ? 1 : 5)) % 6;
                const newStateKey = stateKey(state.position, newDir, state.sp, state.mp - 1, true);

                if (!seen.has(newStateKey)) {
                    seen.add(newStateKey);
                    queue.push({
                        position: state.position,
                        direction: newDir,
                        sp: state.sp,
                        mp: state.mp - 1,
                        lastTurn: true
                    });
                }
            }
        }
    }

    // Конвертируем результат в массив координат
    return Array.from(out).map(posStr => {
        const [q, r, s] = posStr.split(',').map(Number);
        return { q, r, s };
    });
}

/** Отображает доступные ходы на карте */
export function showMovementCells(ship, allShips) {
    console.log('Calculating movement for ship:', ship.id);

    // Очищаем предыдущие подсветки
    clearMovementHighlight();

    // Рассчитываем доступные ходы
    movementCells = calculateMovementCells(ship, allShips);
    selectedShipForMovement = ship;

    console.log('Movement cells calculated:', movementCells.length);

    // Подсвечиваем доступные гексы
    highlightMovementCells(movementCells);
}

/** Очищает подсветку движения */
export function clearMovementHighlight() {
    // Убираем CSS классы с гексов
    document.querySelectorAll('#hexmap polygon.movement-available').forEach(poly => {
        poly.classList.remove('movement-available');
        poly.setAttribute('fill', '#dde');
    });

    movementCells = [];
    selectedShipForMovement = null;
}

/** Подсвечивает гексы доступные для движения */
function highlightMovementCells(cells) {
    cells.forEach(cell => {
        const poly = document.querySelector(`#hexmap polygon[data-q="${cell.q}"][data-r="${cell.r}"][data-s="${cell.s}"]`);
        if (poly) {
            poly.classList.add('movement-available');
            poly.setAttribute('fill', 'rgba(52,211,153,0.3)'); // Зеленоватый цвет
        }
    });
}

/** Проверяет, доступен ли гекс для движения */
export function isMovementCellAvailable(q, r, s) {
    return movementCells.some(cell => cell.q === q && cell.r === r && cell.s === s);
}

/** Получает текущий выбранный корабль для движения */
export function getSelectedShipForMovement() {
    return selectedShipForMovement;
}

/** Подсветка конкретного корабля на карте */
export function highlightShipOnMap(shipId) {
    // Убираем предыдущую подсветку
    document.querySelectorAll('.ship-icon.highlighted').forEach(el => {
        el.classList.remove('highlighted');
        el.style.filter = '';
    });

    // Находим иконку корабля и подсвечиваем
    const shipIcon = document.querySelector(`.ship-icon[data-ship-id="${shipId}"]`);
    if (shipIcon) {
        shipIcon.classList.add('highlighted');
        shipIcon.style.filter = 'drop-shadow(0 0 5px #ff0000)';
        console.log('Ship highlighted:', shipId);
    } else {
        console.log('Ship icon not found for highlighting:', shipId);
    }
}

/** Показывает кнопки поворота только для выбранного корабля */
export function showRotationControlsForShip(shipId) {
    console.log('Showing rotation controls for ship:', shipId);

    // Скрываем все кнопки
    document.querySelectorAll('.ship-rotation-controls').forEach(el => {
        el.style.display = 'none';
    });

    // Показываем кнопки для выбранного корабля
    const controls = document.querySelector(`.ship-rotation-controls[data-ship-id="${shipId}"]`);
    if (controls) {
        controls.style.display = 'block';
        console.log('Controls shown for ship:', shipId);
    } else {
        console.log('Controls not found for ship:', shipId);
    }
}