// public/js/hexmap.js

export const HEX_SIZE = 20;
export const GRID_W   = 20;
export const GRID_H   = 20;

let selectedHex = null;

/** Рисует pointy-top гекс-карту в <svg id="hexmap"> */
export function drawHexGrid() {
    const svg = document.getElementById('hexmap');
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
            // Добавляем data-атрибуты для координат
            poly.setAttribute('data-q', q);
            poly.setAttribute('data-r', r);
            poly.setAttribute('data-s', s);
            poly.addEventListener('click', onHexClick);
            svg.appendChild(poly);
        }
    }
}

function onHexClick(evt) {
    if (selectedHex) selectedHex.setAttribute('fill', '#dde');
    selectedHex = evt.currentTarget;
    selectedHex.setAttribute('fill', '#cfc');
}

/** Рисует все выставленные корабли как SVG <image> */
export function renderPlacedShips(ships) {
    // Удаляем предыдущие иконки
    document.querySelectorAll('.ship-icon').forEach(el => el.remove());

    const svg = document.getElementById('hexmap');
    const w   = svg.clientWidth;
    const h   = svg.clientHeight;
    const layout = Layout(layout_pointy, Point(HEX_SIZE, HEX_SIZE), Point(w/2, h/2));

    ships.forEach(s => {
        const hex = Hex(s.position.q, s.position.r, s.position.s);
        const { x, y } = hex_to_pixel(layout, hex);

        const img = document.createElementNS('http://www.w3.org/2000/svg','image');
        img.setAttribute('href', `/icons/${s.shipClass.toUpperCase()}.png`);
        img.setAttribute('width', HEX_SIZE * 2);
        img.setAttribute('height', HEX_SIZE * 2);
        img.setAttribute('x', x - HEX_SIZE);
        img.setAttribute('y', y - HEX_SIZE);
        img.classList.add('ship-icon');
        svg.appendChild(img);
    });
}
