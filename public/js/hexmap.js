// public/js/hexmap.js

export const HEX_SIZE = 20;
export const GRID_W   = 20;
export const GRID_H   = 20;

let selectedHex = null;

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

    // Удаляем предыдущие иконки
    document.querySelectorAll('.ship-icon').forEach(el => el.remove());

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

        // Попробуем сначала картинку
        const iconName = shipClassToIcon[ship.shipClass] || 'unknown';
        const iconPath = `/icons/${iconName}.png`;

        // Создаем группу для корабля
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('ship-icon');
        group.setAttribute('data-ship-id', ship.id);

        // Сначала пробуем загрузить картинку
        const img = document.createElementNS('http://www.w3.org/2000/svg','image');
        img.setAttribute('href', iconPath);
        img.setAttribute('width', HEX_SIZE * 1.5);
        img.setAttribute('height', HEX_SIZE * 1.5);
        img.setAttribute('x', x - HEX_SIZE * 0.75);
        img.setAttribute('y', y - HEX_SIZE * 0.75);

        // Fallback: если картинка не загрузилась, показываем цветной круг с текстом
        img.onerror = () => {
            console.log(`Icon not found: ${iconPath}, using fallback`);
            img.remove();

            // Создаем fallback элемент
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', HEX_SIZE * 0.8);
            circle.setAttribute('fill', shipClassColors[ship.shipClass] || '#666');
            circle.setAttribute('stroke', '#000');
            circle.setAttribute('stroke-width', '2');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', y + 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '10');
            text.setAttribute('fill', '#fff');
            text.setAttribute('font-weight', 'bold');
            text.textContent = ship.shipClass.charAt(0); // Первая буква класса

            group.appendChild(circle);
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