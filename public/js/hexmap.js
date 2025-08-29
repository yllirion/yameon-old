// public/js/hexmap.js

export const HEX_SIZE = 20;
export const GRID_W   = 27;
export const GRID_H   = 27;

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
// Исправленное соответствие кубическим координатам
const HEX_DIRECTIONS = [
    Math.PI,             // 0: West (180°)
    4 * Math.PI / 3,     // 1: Northwest (240°)
    5 * Math.PI / 3,     // 2: Northeast (300°)
    0,                   // 3: East (0°)
    Math.PI / 3,         // 4: Southeast (60°)
    2 * Math.PI / 3      // 5: Southwest (120°)
];

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

/** Рисует pointy-top гекс-карту в <svg id="hexmap"> используя только кубические координаты */
export function drawHexGrid(gamePhase = null, currentPlayerId = null, playerId = null) {
    const svg = document.getElementById('hexmap');
    if (!svg) {
        console.error('SVG element #hexmap not found');
        return;
    }

    const w = svg.clientWidth;
    const h = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));
    svg.innerHTML = '';

    // Определяем, какой игрок какую зону получает
    const isFirstPlayer = (currentPlayerId === playerId);

    const gridRadius = 13;

    for (let q = -gridRadius; q <= gridRadius; q++) {
        const r1 = Math.max(-gridRadius, -q - gridRadius);
        const r2 = Math.min(gridRadius, -q + gridRadius);

        for (let r = r1; r <= r2; r++) {
            const s = -q - r;

            if (Math.abs(q) > 13 || Math.abs(r) > 13 || Math.abs(s) > 13) continue;

            const hex = Hex(q, r, s);
            const pts = polygon_corners(layout, hex)
                .map(p => `${p.x},${p.y}`)
                .join(' ');

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts);
            poly.setAttribute('stroke', '#333');
            poly.setAttribute('stroke-width', '1');

            // Определяем цвет гекса в зависимости от фазы и зоны
            let fillColor = '#dde'; // По умолчанию серый

            if (gamePhase === 'placement') {
                const zone = getHexZone({ q, r, s });

                if (zone === 'blue') {
                    fillColor = isFirstPlayer ? '#2196F3' : '#1565C0'; // Светло-синий для своей зоны, темнее для чужой
                    poly.classList.add('placement-zone', 'blue-zone');
                } else if (zone === 'yellow') {
                    fillColor = !isFirstPlayer ? '#FFD600' : '#F9A825'; // Светло-желтый для своей зоны, темнее для чужой
                    poly.classList.add('placement-zone', 'yellow-zone');
                } else if (zone === 'neutral') {
                    fillColor = '#BA68C8'; // Фиолетовый
                    poly.classList.add('neutral-zone');
                }
            }

            poly.setAttribute('fill', fillColor);
            poly.setAttribute('data-q', q);
            poly.setAttribute('data-r', r);
            poly.setAttribute('data-s', s);

            poly.setAttribute('data-original-fill', fillColor);

            poly.addEventListener('mouseenter', () => {
                if (poly.classList.contains('movement-available') ||
                    poly.classList.contains('weapon-arc-highlight')) {
                    return;
                }

                if (gamePhase === 'placement') {
                    const zone = getHexZone({ q, r, s });
                    // Подсветка только для своей зоны расстановки
                    if ((zone === 'blue' && isFirstPlayer) || (zone === 'yellow' && !isFirstPlayer)) {
                        poly.style.filter = 'brightness(1.2)';
                    }
                } else if (poly !== selectedHex) {
                    poly.setAttribute('fill', '#ccf');
                }
            });

            poly.addEventListener('mouseleave', () => {
                if (poly.classList.contains('movement-available')) {
                    poly.setAttribute('fill', 'rgba(52,211,153,0.3)');
                    return;
                }
                if (poly.classList.contains('weapon-arc-highlight')) {
                    poly.setAttribute('fill', 'rgba(239, 68, 68, 0.3)');
                    return;
                }

                // Сброс фильтра яркости
                poly.style.filter = '';

                // Восстановление исходного цвета
                if (poly !== selectedHex) {
                    // Получаем сохраненный исходный цвет
                    const originalFill = poly.getAttribute('data-original-fill') || '#dde';
                    poly.setAttribute('fill', originalFill);
                }
            });

            // Модифицируем hover эффект для зон расстановки
            /*
            poly.addEventListener('mouseenter', () => {
                if (poly.classList.contains('movement-available') ||
                    poly.classList.contains('weapon-arc-highlight')) {
                    return;
                }

                if (gamePhase === 'placement' && poly.classList.contains('placement-zone')) {
                    // Подсветка только для своей зоны
                    const zone = getHexZone({ q, r, s });
                    if ((zone === 'blue' && isFirstPlayer) || (zone === 'yellow' && !isFirstPlayer)) {
                        poly.style.filter = 'brightness(1.2)';
                    }
                } else if (poly !== selectedHex) {
                    poly.setAttribute('fill', '#ccf');
                }
            });

            poly.addEventListener('mouseleave', () => {
                if (poly.classList.contains('movement-available')) {
                    poly.setAttribute('fill', 'rgba(52,211,153,0.3)');
                    return;
                }
                if (poly.classList.contains('weapon-arc-highlight')) {
                    poly.setAttribute('fill', 'rgba(239, 68, 68, 0.3)');
                    return;
                }

                if (gamePhase === 'placement') {
                    poly.style.filter = '';
                } else if (poly !== selectedHex) {
                    poly.setAttribute('fill', '#dde');
                }
            });
             */

            svg.appendChild(poly);
        }
    }

    console.log('Hex grid drawn with zones');
}

/**
 * Определяет принадлежность гекса к зоне расстановки
 * @param {Object} hex - Объект с координатами {q, r, s}
 * @returns {string} 'blue', 'yellow', 'neutral' или null
 */
export function getHexZone(hex) {
    const { q, r, s } = hex;

    // Размер стороны ромба (радиус от центра)
    const ZONE_RADIUS = 4; // Для ромба со стороной 9 гексов

    // Синяя зона - центр в (-9, 0, 9)
    const blueCenter = { q: -9, r: 0, s: 9 };
    const distFromBlue = Math.abs(q - blueCenter.q) +
        Math.abs(r - blueCenter.r) +
        Math.abs(s - blueCenter.s);

    if (distFromBlue <= ZONE_RADIUS * 2) {
        return 'blue';
    }

    // Желтая зона - центр в (9, 0, -9)
    const yellowCenter = { q: 9, r: 0, s: -9 };
    const distFromYellow = Math.abs(q - yellowCenter.q) +
        Math.abs(r - yellowCenter.r) +
        Math.abs(s - yellowCenter.s);

    if (distFromYellow <= ZONE_RADIUS * 2) {
        return 'yellow';
    }

    // Все остальное - нейтральная зона (серая)
    return null;
}

function onHexClick(evt) {
    if (selectedHex) selectedHex.setAttribute('fill', '#dde');
    selectedHex = evt.currentTarget;
    selectedHex.setAttribute('fill', '#cfc');
}

/** Рисует все выставленные корабли как SVG элементы используя кубические координаты */
export function renderPlacedShips(ships, currentPlayerId = null) {
    console.log('Rendering ships with cubic coordinates:', ships);

    // Удаляем предыдущие иконки и кнопки
    document.querySelectorAll('.ship-icon, .ship-rotation-controls').forEach(el => el.remove());

    const svg = document.getElementById('hexmap');
    if (!svg) {
        console.error('SVG element not found');
        return;
    }

    const w = svg.clientWidth;
    const h = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));

    ships.forEach(ship => {
        // Прямое использование кубических координат корабля
        const hex = Hex(ship.position.q, ship.position.r, ship.position.s);
        const { x, y } = hex_to_pixel(layout, hex);

        console.log(`Rendering ship ${ship.id} at cubic coords (${ship.position.q}, ${ship.position.r}, ${ship.position.s}) -> pixel (${x}, ${y})`);

        // Получаем угол поворота из направления корабля
        const rotation = HEX_DIRECTIONS[ship.dir || 0];

        // Попробуем сначала картинку
        const iconName = shipClassToIcon[ship.shipClass] || 'unknown';
        const iconPath = `/icons/${iconName}.png`;

        // Создаем группу для корабля
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('ship-icon');
        group.setAttribute('data-ship-id', ship.id);

        if (currentPlayerId) {
            if (ship.owner === currentPlayerId) {
                group.classList.add('player-ship');
            } else {
                group.classList.add('enemy-ship');
            }
        }

        if (ship.status === 'activated') {
            group.classList.add('activated');
        }

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

        // Добавляем отладочную информацию о направлении корабля
        const debugText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        debugText.setAttribute('x', 0);
        debugText.setAttribute('y', -HEX_SIZE);
        debugText.setAttribute('text-anchor', 'middle');
        debugText.setAttribute('font-size', '12');
        debugText.setAttribute('fill', '#ff0000');
        debugText.setAttribute('font-weight', 'bold');
        debugText.textContent = `Dir: ${ship.dir || 0}`;
        group.appendChild(debugText);

        console.log(`Ship ${ship.id} at dir=${ship.dir}, angle=${rotationDegrees} degrees (${rotation} radians)`);

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

    console.log(`Rendered ${ships.length} ships on the map using cubic coordinates`);
}

/** Добавляет кнопки поворота под кораблем используя кубические координаты */
export function addRotationControls(ship, isCurrentPlayer, isPlacementPhase, onRotate) {
    console.log('addRotationControls called:', {
        shipId: ship.id,
        isCurrentPlayer,
        isPlacementPhase,
        shipStatus: ship.status
    });

    // В боевой фазе показываем кнопки только для активированных кораблей
    if (!isCurrentPlayer) {
        console.log('Not current player, skipping rotation controls');
        return;
    }

    if (!isPlacementPhase && ship.status !== 'activated') {
        console.log('Battle phase but ship not activated, skipping rotation controls');
        return;
    }

    if (!isPlacementPhase && ship.currentManeuverability <= 0 && !ship.hasFreeTurn) {
        console.log('No maneuverability points and no free turn, skipping rotation controls');
        return;
    }

    const svg = document.getElementById('hexmap');
    if (!svg) return;

    const w = svg.clientWidth;
    const h = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));

    // Используем кубические координаты корабля напрямую
    const hex = Hex(ship.position.q, ship.position.r, ship.position.s);
    const { x, y } = hex_to_pixel(layout, hex);

    console.log(`Adding rotation controls for ship at cubic coords (${ship.position.q}, ${ship.position.r}, ${ship.position.s}) -> pixel (${x}, ${y})`);

    // Создаем группу для кнопок
    const controlGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    controlGroup.classList.add('ship-rotation-controls');
    controlGroup.setAttribute('data-ship-id', ship.id);
    controlGroup.style.display = 'none'; // Скрываем по умолчанию

    // Получаем угол направления корабля
    const shipAngle = HEX_DIRECTIONS[ship.dir || 0];

    // Расстояние от центра корабля до кнопок
    const buttonDistance = HEX_SIZE * 1.8; // Увеличил расстояние для лучшей видимости

    // Углы для размещения кнопок (слева и справа от носа)
    const leftButtonAngle = shipAngle - Math.PI / 8;
    const rightButtonAngle = shipAngle + Math.PI / 8;

    // Вычисляем позиции кнопок
    const leftButtonX = x + Math.cos(leftButtonAngle) * buttonDistance;
    const leftButtonY = y + Math.sin(leftButtonAngle) * buttonDistance;

    const rightButtonX = x + Math.cos(rightButtonAngle) * buttonDistance;
    const rightButtonY = y + Math.sin(rightButtonAngle) * buttonDistance;

    // Кнопка поворота влево
    const leftButton = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    leftButton.classList.add('rotation-button');
    leftButton.style.cursor = 'pointer';

    const leftCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    leftCircle.setAttribute('cx', leftButtonX);
    leftCircle.setAttribute('cy', leftButtonY);
    leftCircle.setAttribute('r', 8);
    leftCircle.setAttribute('fill', '#2196F3');
    leftCircle.setAttribute('stroke', '#fff');
    leftCircle.setAttribute('stroke-width', 2);

    const leftText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    leftText.setAttribute('x', leftButtonX);
    leftText.setAttribute('y', leftButtonY + 5);
    leftText.setAttribute('text-anchor', 'middle');
    leftText.setAttribute('font-size', '10');
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
    rightCircle.setAttribute('cx', rightButtonX);
    rightCircle.setAttribute('cy', rightButtonY);
    rightCircle.setAttribute('r', 8);
    rightCircle.setAttribute('fill', '#2196F3');
    rightCircle.setAttribute('stroke', '#fff');
    rightCircle.setAttribute('stroke-width', 2);

    const rightText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rightText.setAttribute('x', rightButtonX);
    rightText.setAttribute('y', rightButtonY + 5);
    rightText.setAttribute('text-anchor', 'middle');
    rightText.setAttribute('font-size', '10');
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

/** Расчет доступных ходов для корабля с новой логикой маневренности */
function calculateMovementCells(ship, allShips) {
    const out = new Set();
    const seen = new Set();

    // ВАЖНО: Используем ТЕКУЩИЕ очки движения, а не максимальные
    const currentSP = ship.currentSpeed || 0;  // Убираем fallback на maxSpeed
    const currentMP = ship.currentManeuverability || 0;  // Убираем fallback на maxManeuverability

    console.log(`Client: Calculating movement for ship ${ship.id}: currentSP=${currentSP}, currentMP=${currentMP}`);
    console.log(`Ship stats:`, {
        currentSpeed: ship.currentSpeed,
        maxSpeed: ship.maxSpeed,
        currentManeuverability: ship.currentManeuverability,
        maxManeuverability: ship.maxManeuverability
    });

    // Если у корабля нет очков движения, возвращаем пустой массив
    if (currentSP === 0 && currentMP === 0) {
        console.log('Ship has no movement points, returning empty array');
        return [];
    }

    // Ключ состояния: позиция, направление, SP, MP, бесплатный поворот доступен
    const stateKey = (pos, dir, sp, mp, freeTurnAvailable) =>
        `${pos.q},${pos.r},${pos.s},${dir},${sp},${mp},${freeTurnAvailable}`;

    const queue = [{
        position: ship.position,
        direction: ship.dir,
        sp: currentSP,
        mp: currentMP,
        freeTurnAvailable: false  // Есть ли бесплатный поворот
    }];

    seen.add(stateKey(ship.position, ship.dir, currentSP, currentMP, false));

    while (queue.length > 0) {
        const state = queue.shift();

        // Добавляем позицию в результат (кроме начальной)
        if (state.position.q !== ship.position.q ||
            state.position.r !== ship.position.r ||
            state.position.s !== ship.position.s) {
            out.add(`${state.position.q},${state.position.r},${state.position.s}`);
        }

        // Движение вперед (тратит 1 очко скорости, дает бесплатный поворот)
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

            // Проверяем границы карты
            const outOfBounds = Math.abs(newPos.q) > 13 || Math.abs(newPos.r) > 13 || Math.abs(newPos.s) > 13;

            if (!isOccupied && !outOfBounds) {
                const newStateKey = stateKey(newPos, state.direction, state.sp - 1, state.mp, true);
                if (!seen.has(newStateKey)) {
                    seen.add(newStateKey);
                    queue.push({
                        position: newPos,
                        direction: state.direction,
                        sp: state.sp - 1,
                        mp: state.mp,
                        freeTurnAvailable: true  // После движения получаем бесплатный поворот
                    });
                }
            }
        }

        // Повороты на 60° (влево и вправо)
        for (const turn of [-1, 1]) { // -1 = влево, 1 = вправо
            const newDir = (state.direction + (turn === -1 ? 5 : 1)) % 6;

            let newMP = state.mp;
            let newFreeTurn = state.freeTurnAvailable;

            // Определяем стоимость поворота
            if (state.freeTurnAvailable) {
                // Используем бесплатный поворот
                newFreeTurn = false;
                // MP не тратится
            } else if (state.mp > 0) {
                // Тратим 1 MP на поворот
                newMP = state.mp - 1;
            } else {
                // Нет ни бесплатного поворота, ни MP - пропускаем
                continue;
            }

            const newStateKey = stateKey(state.position, newDir, state.sp, newMP, newFreeTurn);

            if (!seen.has(newStateKey)) {
                seen.add(newStateKey);
                queue.push({
                    position: state.position,
                    direction: newDir,
                    sp: state.sp,
                    mp: newMP,
                    freeTurnAvailable: newFreeTurn
                });
            }
        }
    }

    // Конвертируем результат в массив координат
    const result = Array.from(out).map(posStr => {
        const [q, r, s] = posStr.split(',').map(Number);
        return { q, r, s };
    });

    console.log(`Client: Movement calculation complete: ${result.length} available cells`);
    return result;
}

/** Отображает доступные ходы на карте */
export function showMovementCells(ship, allShips) {
    console.log('Calculating movement for ship:', ship.id);

    // Очищаем предыдущие подсветки
    clearMovementHighlight();

    // Рассчитываем доступные ходы с учетом текущих очков движения
    movementCells = calculateMovementCells(ship, allShips);
    selectedShipForMovement = ship;

    console.log('Movement cells calculated:', movementCells.length);
    console.log('Ship movement points:', {
        currentSpeed: ship.currentSpeed,
        maxSpeed: ship.maxSpeed,
        currentManeuverability: ship.currentManeuverability,
        maxManeuverability: ship.maxManeuverability
    });

    // Подсвечиваем доступные гексы
    highlightMovementCells(movementCells);
}

/** Очищает подсветку движения */
export function clearMovementHighlight() {
    // Скрываем все кнопки поворота
    document.querySelectorAll('.ship-rotation-controls').forEach(el => {
        el.style.display = 'none';
    });

    // Убираем CSS классы с гексов
    document.querySelectorAll('#hexmap polygon.movement-available').forEach(poly => {
        poly.classList.remove('movement-available');
        poly.setAttribute('fill', '#dde');
    });

    movementCells = [];
    selectedShipForMovement = null;
}

/** Подсвечивает гексы доступные для движения используя кубические координаты */
function highlightMovementCells(cells) {
    cells.forEach(cell => {
        // Ищем полигон по кубическим координатам
        const poly = document.querySelector(`#hexmap polygon[data-q="${cell.q}"][data-r="${cell.r}"][data-s="${cell.s}"]`);
        if (poly) {
            poly.classList.add('movement-available');
            poly.setAttribute('fill', 'rgba(52,211,153,0.3)'); // Зеленоватый цвет
            console.log(`Highlighted movement cell at cubic coords (${cell.q}, ${cell.r}, ${cell.s})`);
        } else {
            console.warn(`Could not find polygon for cubic coords (${cell.q}, ${cell.r}, ${cell.s})`);
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