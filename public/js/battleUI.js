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

/** Подсветка корабля на карте */
function highlightShipOnMap(shipId) {
    // Убираем предыдущую подсветку
    document.querySelectorAll('.ship-icon.highlighted').forEach(el => {
        el.classList.remove('highlighted');
    });

    // Находим иконку корабля и подсвечиваем
    const shipIcon = document.querySelector(`.ship-icon[data-ship-id="${shipId}"]`);
    if (shipIcon) {
        shipIcon.classList.add('highlighted');
    }
}

/** Инициализация боевого UI */
export function initBattleUI(showView, socket, playerId) {
    console.log('Initializing battle UI for player:', playerId);

    // Отписываем старые слушатели
    socket.off('startGame');
    socket.off('updateGame');
    socket.off('battleState');
    socket.off('gameOver');
    socket.off('placementError');
    socket.off('turnError');
    socket.off('turnChanged');

    // Обработчик ошибок расстановки
    socket.on('placementError', ({ message }) => {
        logBattle(`Ошибка: ${message}`);
    });

    // Обработчик ошибок хода
    socket.on('turnError', ({ message }) => {
        logBattle(`Ошибка хода: ${message}`);
    });

    // Обработчик смены хода
    socket.on('turnChanged', ({ currentPlayerNick, round }) => {
        logBattle(`Ход переходит к ${currentPlayerNick}. Раунд ${round}`);
    });

    socket.on('battleState', state => {
        console.log('[battleState received]', state);
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
            if (initialPlacement) {
                initialPlacement = null;
                lastShips = [];
                logBattle(`Фаза: Бой начался! Раунд ${state.round}`);
            }
            renderBattle(state, showView, socket, playerId);
        }
    });

    socket.on('gameOver', ({ loser }) => {
        logBattle(`Игрок ${loser} сдался — игра окончена`);
        showView('lobby');
    });

    // Настраиваем кнопки боевого интерфейса
    setupBattleButtons(socket, playerId);
}

function setupBattleButtons(socket, playerId) {
    // Кнопка End Turn
    const endTurnBtn = document.getElementById('endTurnBtn');
    if (endTurnBtn) {
        // Убираем старые обработчики
        endTurnBtn.onclick = null;

        endTurnBtn.onclick = () => {
            console.log('End Turn button clicked');

            // Получаем текущую комнату
            const roomId = getCurrentRoomId();  // ← Используем импортированную функцию

            if (!roomId) {
                logBattle('Ошибка: не найдена текущая комната');
                return;
            }

            // Отправляем сигнал о завершении хода
            socket.emit('endTurn', { roomId });
            logBattle('Ход завершен');
        };
    }

    // Кнопка Surrender
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) {
        surrenderBtn.onclick = () => {
            if (confirm('Вы уверены, что хотите сдаться?')) {
                socket.emit('surrender');
                logBattle('Вы сдались');
            }
        };
    }
}

/** Рендер фазы расстановки */
function renderPlacement(state, showView, socket, playerId) {
    console.log('Rendering placement phase');
    showView('battle');

    // Рисуем сетку и иконки уже выставленных кораблей
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);

        // Добавляем обработчики кликов на гексы ПОСЛЕ отрисовки
        setTimeout(() => {
            setupHexClickHandlers(state, socket, playerId);
        }, 100);
    });

    // Обновляем текст хода
    const turnElement = document.getElementById('turnPlayer');
    if (turnElement) {
        turnElement.textContent = state.currentPlayer === playerId
            ? 'Ваш ход расстановки'
            : 'Ход соперника';
    }

    // Рисуем карточки кораблей
    renderPlacementLists(state, playerId);
}

/** Настройка обработчиков кликов на гексы */
function setupHexClickHandlers(state, socket, playerId) {
    console.log('Setting up hex click handlers');

    // Удаляем старые обработчики
    document.querySelectorAll('#hexmap polygon').forEach(poly => {
        poly.onclick = null;
    });

    // Вешаем новые обработчики кликов на полигоны гекса
    document.querySelectorAll('#hexmap polygon').forEach(poly => {
        poly.onclick = (event) => {
            console.log('Hex clicked!', poly.dataset);

            if (state.currentPlayer !== playerId) {
                logBattle('Сейчас не ваш ход');
                return;
            }

            if (!selectedShipToPlace) {
                logBattle('Сначала выберите корабль слева');
                return;
            }

            const q = parseInt(poly.dataset.q);
            const r = parseInt(poly.dataset.r);
            const s = parseInt(poly.dataset.s);

            console.log('Placing ship:', {
                coords: { q, r, s },
                ship: selectedShipToPlace
            });

            socket.emit('placeShip', {
                roomId:    state.id,
                projectId: selectedShipToPlace.projectId,
                position:  { q, r, s }
            });

            // Снимаем выбор
            document.querySelectorAll('.ship-card.selected')
                .forEach(c => c.classList.remove('selected'));
            selectedShipToPlace = null;

            logBattle(`Размещаем корабль в (${q},${r})`);
        };
    });
}

/** Генерация карточек pending и отображение статуса */
function renderPlacementLists(state, playerId) {
    console.log('Rendering placement lists');

    const pending     = state.pendingPlacement;
    const myContainer = document.getElementById('player1Ships');
    const opContainer = document.getElementById('player2Ships');

    if (!myContainer || !opContainer) {
        console.error('Player ship containers not found');
        return;
    }

    myContainer.innerHTML = '';
    opContainer.innerHTML = '';

    // Распределяем группы по контейнерам
    Object.entries(pending).forEach(([pid, groups]) => {
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
                        console.log('Ship card clicked:', projectId);

                        // подсветка
                        document.querySelectorAll('.ship-card.selected')
                            .forEach(c => c.classList.remove('selected'));
                        card.classList.add('selected');
                        selectedShipToPlace = { projectId };

                        logBattle(`Выбран корабль: ${shipClass}`);
                    };
                }

                parent.appendChild(card);
            }
        });
    });
}

/** Рендер основной боевой фазы */
function renderBattle(state, showView, socket, playerId) {
    console.log('Rendering battle phase');
    showView('battle');

    // Сетка и иконки
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);
    });

    // Заголовок хода
    const turnElement = document.getElementById('turnPlayer');
    if (turnElement) {
        turnElement.textContent = state.currentPlayer === playerId ? 'Ваш ход' : 'Ход соперника';
    }

    // Показываем списки уже размещённых кораблей
    const myShips = state.ships.filter(s => s.owner === playerId);
    const opShips = state.ships.filter(s => s.owner !== playerId);

    renderFleetPanel('player1Ships', myShips);
    renderFleetPanel('player2Ships', opShips);
}

/** Отрисовка списка кораблей в бою */

function renderFleetPanel(containerId, ships) {
    const cont = document.getElementById(containerId);
    if (!cont) return;

    cont.innerHTML = '';

    if (ships.length === 0) {
        cont.innerHTML = '<div class="no-ships">Нет кораблей</div>';
        return;
    }

    // Сгруппировать по классу
    const groups = ships.reduce((acc, ship) => {
        (acc[ship.shipClass] = acc[ship.shipClass] || []).push(ship);
        return acc;
    }, {});

    Object.entries(groups).forEach(([shipClass, list]) => {
        // Создаем контейнер для группы
        const groupContainer = document.createElement('div');
        groupContainer.className = 'ship-class-group';

        // Заголовок группы (складной)
        const header = document.createElement('div');
        header.className = 'ship-group-header';
        header.innerHTML = `
            <span class="toggle-icon">▼</span>
            <strong>${shipClass}</strong> 
            <span class="ship-count">×${list.length}</span>
        `;

        // Контейнер для карточек кораблей
        const shipsContainer = document.createElement('div');
        shipsContainer.className = 'ships-container visible';

        list.forEach((ship, index) => {
            const shipCard = document.createElement('div');
            shipCard.className = 'battle-ship-card clickable';
            shipCard.dataset.shipId = ship.id;

            // Правильный расчет maxHP через активацию
            const maxHP = classStats[ship.shipClass].activation;  // ← ИСПРАВЛЕНО
            const hpPercent = (ship.hp / maxHP) * 100;
            const hpColor = hpPercent > 60 ? '#4CAF50' : hpPercent > 30 ? '#FF9800' : '#F44336';

            shipCard.innerHTML = `
                <div class="ship-card-header">
                    <span class="ship-name">${shipClass} #${index + 1}</span>
                    <span class="ship-status ${ship.hp > 0 ? 'active' : 'destroyed'}">${ship.hp > 0 ? 'Активен' : 'Уничтожен'}</span>
                </div>
                <div class="ship-stats">
                    <div class="hp-bar">
                        <div class="hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor}"></div>
                        <span class="hp-text">${ship.hp}/${maxHP} HP</span>
                    </div>
                    <div class="ship-details">
                        <span>Поз: (${ship.position.q}, ${ship.position.r})</span>
                        <span>Ак:${classStats[shipClass].activation} Сп:${classStats[shipClass].speed} Бр:${classStats[shipClass].armor}</span>
                    </div>
                </div>
            `;

            // Клик по карточке корабля
            shipCard.onclick = () => {
                // Убираем выделение с других карточек
                document.querySelectorAll('.battle-ship-card.selected')
                    .forEach(c => c.classList.remove('selected'));

                // Выделяем эту карточку
                shipCard.classList.add('selected');

                // Подсвечиваем на карте
                highlightShipOnMap(ship.id);

                // Логируем
                logBattle(`Выбран ${shipClass} #${index + 1} (HP: ${ship.hp}/${maxHP})`);
            };

            shipsContainer.appendChild(shipCard);
        });

        // Переключение видимости группы
        header.addEventListener('click', () => {
            const isVisible = shipsContainer.classList.toggle('visible');
            header.querySelector('.toggle-icon').textContent = isVisible ? '▼' : '▶';
        });

        groupContainer.appendChild(header);
        groupContainer.appendChild(shipsContainer);
        cont.appendChild(groupContainer);
    });
}