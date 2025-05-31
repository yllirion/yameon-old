// public/js/battleUI.js

import { drawHexGrid, renderPlacedShips } from './hexmap.js';

/** Базовые характеристики по классу – используется для карточек и логов */
const classStats = {
    'Фрегат':   { speed: 5, maneuverability: 5, armor: 5, activation: 2 },
    'Эсминец':  { speed: 4, maneuverability: 6, armor: 6, activation: 3 },
    'Крейсер':  { speed: 3, maneuverability: 7, armor: 7, activation: 4 },
    'Линкор':   { speed: 2, maneuverability: 8, armor: 8, activation: 5 },
    'Дредноут': { speed: 1, maneuverability: 9, armor: 9, activation: 6 }
};

let selectedShipToPlace = null;
let initialPlacement    = null;
let lastShips           = [];

/** Пишет сообщение в лог снизу в #battleLog */
function logBattle(msg) {
    const footer = document.getElementById('battleLog');
    if (!footer) return;
    const div = document.createElement('div');
    div.textContent = msg;
    footer.appendChild(div);
    footer.scrollTop = footer.scrollHeight;
}

/** Инициализация боевого UI */
export function initBattleUI(showView, socket, playerId) {
    // Отписываем старые слушатели
    socket.off('startGame');
    socket.off('updateGame');
    socket.off('battleState');
    socket.off('gameOver');

    socket.on('battleState', state => {
        console.log('[battleState]', state);
        if (state.phase === 'placement') {
            // При первой расстановке запомним исходный список
            if (!initialPlacement) {
                initialPlacement = JSON.parse(JSON.stringify(state.pendingPlacement));
                logBattle('Фаза: Расстановка кораблей');
            }
            // Логируем новые выставленные корабли
            const newShips = state.ships.filter(s => !lastShips.some(ls => ls.id === s.id));
            newShips.forEach(s => {
                logBattle(`Корабль ${s.shipClass} выставлен в (${s.position.q},${s.position.r})`);
            });
            lastShips = state.ships.slice();

            renderPlacement(state, showView, socket, playerId);
        }
        else if (state.phase === 'battle') {
            // сбросим данные placement
            initialPlacement = null;
            lastShips = [];
            logBattle(`Фаза: Бой, раунд ${state.round}`);
            renderBattle(state, showView, socket, playerId);
        }
    });

    socket.on('gameOver', ({ loser }) => {
        logBattle(`Игрок ${loser} сдался — игра окончена`);
        showView('lobby');
    });
}

/** Рендер фазы расстановки */
function renderPlacement(state, showView, socket, playerId) {
    showView('battle');

    // Рисуем сетку и иконки уже выставленных кораблей
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);
    });

    // Обновляем текст хода
    document.getElementById('turnPlayer').textContent =
        state.currentPlayer === playerId
            ? 'Ваш ход расстановки'
            : 'Ход соперника';

    // Рисуем карточки кораблей
    renderPlacementLists(state, playerId);

    // Вешаем клики на полигоны гекса
    document.querySelectorAll('#hexmap polygon').forEach(poly => {
        poly.onclick = () => {
            if (state.currentPlayer !== playerId) return;
            if (!selectedShipToPlace) {
                alert('Сначала выберите корабль слева');
                return;
            }
            const q = +poly.dataset.q;
            const r = +poly.dataset.r;
            const s = +poly.dataset.s;

            console.log('Hex clicked:', q, r, selectedShipToPlace);

            socket.emit('placeShip', {
                roomId:    state.id,
                projectId: selectedShipToPlace.projectId,
                position:  { q, r, s }

            });
            // Снимаем выбор
            document.querySelectorAll('.ship-card.selected')
                .forEach(c => c.classList.remove('selected'));
            selectedShipToPlace = null;
        };
    });
}

/** Генерация карточек pending и отображение статуса */



function renderPlacementLists(state, playerId) {
    const pending     = state.pendingPlacement;            // { pid: [ {shipClass, projectId, count}, … ], … }
    const myContainer = document.getElementById('player1Ships');
    const opContainer = document.getElementById('player2Ships');
    myContainer.innerHTML = '';
    opContainer.innerHTML = '';

    // Распределяем группы по контейнерам
    Object.entries(pending).forEach(([pid, groups]) => {
        // если это ваш pid — рисуем в «Ваш флот», иначе в «Противник»
        const parent = pid === playerId ? myContainer : opContainer;

        groups.forEach(group => {
            const { shipClass, projectId, count } = group;
            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = 'ship-card';
                card.dataset.projectId = projectId;
                card.innerHTML = `
          <h4>${shipClass}</h4>
          <p>Сп:${classStats[shipClass].speed}
             Мн:${classStats[shipClass].maneuverability}
             Бр:${classStats[shipClass].armor}
             Ак:${classStats[shipClass].activation}</p>
        `;
                // кликабельны только ваши нерасставленные

                if (pid === playerId) {
                    card.classList.add('clickable');
                    card.onclick = () => {
                        // подсветка
                        document.querySelectorAll('.ship-card.selected')
                            .forEach(c => c.classList.remove('selected'));
                        card.classList.add('selected');
                        selectedShipToPlace = { projectId };
                    };
                }

                parent.appendChild(card);
            }
        });
    });
}

/** Рендер основной боевой фазы */
function renderBattle(state, showView, socket, playerId) {
    showView('battle');

    // Сетка и иконки
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);
    });

    // Заголовок хода
    document.getElementById('turnPlayer').textContent =
        state.currentPlayer === playerId ? 'Ваш ход' : 'Ход соперника';

    // Показываем списки уже размещённых кораблей
    renderFleetPanel('player1Ships', state.ships.filter(s => s.owner === playerId));
    renderFleetPanel('player2Ships', state.ships.filter(s => s.owner !== playerId));
}

/** Отрисовка списка кораблей в бою */
function renderFleetPanel(containerId, ships) {
    const cont = document.getElementById(containerId);
    alert(ships.join("\n"));
    cont.innerHTML = '';

    // Сгруппировать по классу
    const groups = ships.reduce((acc, ship) => {
        (acc[ship.shipClass] = acc[ship.shipClass] || []).push(ship);
        return acc;
    }, {});

    Object.entries(groups).forEach(([cls, list]) => {
        // Заголовок группы
        const wrapper = document.createElement('div');
        wrapper.className = 'ship-group';
        wrapper.innerHTML = `<span class="toggle-icon">▶</span>${cls} ×${list.length}`;

        // Блок с элементами
        const items = document.createElement('div');
        items.className = 'ship-items';

        list.forEach(ship => {
            const row = document.createElement('div');
            row.className = 'ship-item clickable';
            row.textContent =
                `#${ship.id} — HP: ${ship.hp}` +
                (ship.position
                    ? `, Pos:(${ship.position.q},${ship.position.r},${ship.position.s})`
                    : '');

            // Добавляем обработчик клика по кораблю
            row.onclick = () => {
                // Пример: логируем выбор в баттл-лог и на карте подсвечиваем корабль
                logBattle(`Выбрали ${ship.shipClass} (#${ship.id})`);
                highlightShipOnMap(ship.id);
            };

            items.appendChild(row);
        });

        // Переключение видимости списка внутри группы
        wrapper.addEventListener('click', () => {
            const visible = items.classList.toggle('visible');
            wrapper.querySelector('.toggle-icon').textContent = visible ? '▼' : '▶';
        });

        cont.appendChild(wrapper);
        cont.appendChild(items);
    });
}


function renderBattlePanels(state, playerId) {
    const myShips  = state.ships.filter(s => s.owner === playerId);
    const opShips  = state.ships.filter(s => s.owner !== playerId);
    renderFleetPanel('player1Ships', myShips);
    alert(myShips.join("\n"));
    renderFleetPanel('player2Ships', opShips);
}
