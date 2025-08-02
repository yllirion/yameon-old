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
let currentBattleRoomId = null;

// Кэш для проектов кораблей
let shipProjectsCache = {};

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

/** Загружает информацию о проектах кораблей */
async function loadShipProjects() {
    if (Object.keys(shipProjectsCache).length === 0) {
        try {
            const response = await fetch('/api/ships');
            const projects = await response.json();
            projects.forEach(project => {
                shipProjectsCache[project.id] = project;
            });
            console.log('Ship projects loaded:', shipProjectsCache);
        } catch (error) {
            console.error('Failed to load ship projects:', error);
        }
    }
    return shipProjectsCache;
}

/** Получает имя проекта по ID */
function getProjectName(projectId) {
    const project = shipProjectsCache[projectId];
    return project ? project.name : projectId;
}

/** Получает полную информацию о проекте */
function getProjectInfo(projectId) {
    return shipProjectsCache[projectId] || null;
}

/** Функция для расчета модифицированных характеристик */
function calculateModifiedStats(shipClass, modules) {
    const baseStats = { ...classStats[shipClass] };

    modules.forEach(module => {
        // Простая логика модификации характеристик
        if (module.effect.includes('+1 к скорости')) {
            baseStats.speed += 1;
        } else if (module.effect.includes('-1 к скорости')) {
            baseStats.speed -= 1;
        } else if (module.effect.includes('+1 к манёвренности')) {
            baseStats.maneuverability += 1;
        } else if (module.effect.includes('-1 к манёвренности')) {
            baseStats.maneuverability -= 1;
        } else if (module.effect.includes('+1 к броне')) {
            baseStats.armor += 1;
        } else if (module.effect.includes('-1 к броне')) {
            baseStats.armor -= 1;
        }
    });

    return baseStats;
}

/** Инициализация боевого UI */
export function initBattleUI(showView, socket, playerId) {
    console.log('Initializing battle UI for player:', playerId);

    // Загружаем проекты кораблей
    loadShipProjects();

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

        // Сохраняем roomId локально
        currentBattleRoomId = state.id;

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
            const projectName = getProjectName(projectId);

            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = 'ship-card';
                card.dataset.projectId = projectId;
                card.innerHTML = `
                    <h4>${projectName}</h4>
                    <p class="ship-class-badge">${shipClass}</p>
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

                        logBattle(`Выбран корабль: ${projectName} (${shipClass})`);
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

    // Заголовок хода с подсветкой
    const turnElement = document.getElementById('turnPlayer');
    if (turnElement) {
        const isMyTurn = state.currentPlayer === playerId;
        turnElement.textContent = isMyTurn
            ? `Ваш ход - Раунд ${state.round}`
            : `Ход соперника - Раунд ${state.round}`;
        turnElement.style.color = isMyTurn ? '#4CAF50' : '#F44336';
        turnElement.style.fontWeight = 'bold';
    }

    // Активность кнопки End Turn
    const endTurnBtn = document.getElementById('endTurnBtn');
    if (endTurnBtn) {
        const isMyTurn = state.currentPlayer === playerId;
        endTurnBtn.disabled = !isMyTurn;
        endTurnBtn.style.opacity = isMyTurn ? '1' : '0.5';
    }

    // Показываем списки уже размещённых кораблей
    const myShips = state.ships.filter(s => s.owner === playerId);
    const opShips = state.ships.filter(s => s.owner !== playerId);

    // Генерируем пулы кубиков (пока что моковые данные)
    // TODO: Позже это будет приходить от сервера в state
    const myDicePool = state.dicePoolMy || generateDicePool(state.round, 0);
    const opDicePool = state.dicePoolOp || generateDicePool(state.round, 0);

    // Отрисовываем панели кубиков
    renderDicePool('player1Ships', myDicePool, 'ваши');
    renderDicePool('player2Ships', opDicePool, 'противника');

    // Отрисовываем флоты
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

    // Загружаем проекты кораблей перед отображением
    loadShipProjects();

    // Группируем по проекту, а не только по классу
    const groups = ships.reduce((acc, ship) => {
        const key = `${ship.shipClass}_${ship.projectId}`;
        if (!acc[key]) {
            acc[key] = {
                shipClass: ship.shipClass,
                projectId: ship.projectId,
                ships: []
            };
        }
        acc[key].ships.push(ship);
        return acc;
    }, {});

    Object.entries(groups).forEach(([key, group]) => {
        const { shipClass, projectId, ships } = group;

        // Создаем контейнер для группы
        const groupContainer = document.createElement('div');
        groupContainer.className = 'ship-class-group';

        // Получаем название проекта
        const projectName = getProjectName(projectId);
        const projectInfo = getProjectInfo(projectId);

        // Заголовок группы с названием проекта
        const header = document.createElement('div');
        header.className = 'ship-group-header';
        header.innerHTML = `
            <span class="toggle-icon">▼</span>
            <strong>${shipClass}</strong>
            <span class="project-name">"${projectName}"</span>
            <span class="ship-count">×${ships.length}</span>
        `;

        // Контейнер для карточек кораблей
        const shipsContainer = document.createElement('div');
        shipsContainer.className = 'ships-container visible';

        ships.forEach((ship, index) => {
            const shipCard = document.createElement('div');
            shipCard.className = 'battle-ship-card clickable';
            shipCard.dataset.shipId = ship.id;

            // Правильный расчет maxHP через активацию
            const maxHP = classStats[ship.shipClass].activation;
            const hpPercent = (ship.hp / maxHP) * 100;
            const hpColor = hpPercent > 60 ? '#4CAF50' : hpPercent > 30 ? '#FF9800' : '#F44336';

            // Получаем характеристики проекта (если есть модификации)
            let displayStats = classStats[ship.shipClass];
            if (projectInfo && projectInfo.modules && projectInfo.modules.length > 0) {
                // Если у проекта есть модули, показываем модифицированные характеристики
                displayStats = calculateModifiedStats(ship.shipClass, projectInfo.modules);
            }

            shipCard.innerHTML = `
                <div class="ship-card-header">
                    <span class="ship-name">${projectName} #${index + 1}</span>
                    <span class="ship-class-badge">${shipClass}</span>
                    <span class="ship-status ${ship.hp > 0 ? 'active' : 'destroyed'}">${ship.hp > 0 ? 'Активен' : 'Уничтожен'}</span>
                </div>
                <div class="ship-stats">
                    <div class="hp-bar">
                        <div class="hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor}"></div>
                        <span class="hp-text">${ship.hp}/${maxHP} HP</span>
                    </div>
                    <div class="ship-details">
                        <span>Поз: (${ship.position.q}, ${ship.position.r})</span>
                        <span>Сп:${displayStats.speed} Мн:${displayStats.maneuverability} Бр:${displayStats.armor}</span>
                    </div>
                    ${projectInfo && projectInfo.modules && projectInfo.modules.length > 0 ?
                `<div class="ship-modules">
                            <small>Модули: ${projectInfo.modules.map(m => m.name).join(', ')}</small>
                        </div>` : ''
            }
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

                // Логируем с названием проекта
                logBattle(`Выбран ${projectName} #${index + 1} (${shipClass}, HP: ${ship.hp}/${maxHP})`);
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

function setupBattleButtons(socket, playerId) {
    console.log('Setting up battle buttons for player:', playerId);

    // Кнопка End Turn
    const endTurnBtn = document.getElementById('endTurnBtn');
    console.log('End Turn button found:', endTurnBtn);

    if (endTurnBtn) {
        // Убираем старые обработчики
        endTurnBtn.onclick = null;

        endTurnBtn.onclick = () => {
            console.log('End Turn button clicked!');

            // Используем локальную переменную вместо импорта
            const roomId = currentBattleRoomId;
            console.log('Current room ID:', roomId);

            if (!roomId) {
                console.error('No room ID found');
                logBattle('Ошибка: не найдена текущая комната');
                return;
            }

            console.log('Sending endTurn event with roomId:', roomId);

            // Отправляем сигнал о завершении хода
            socket.emit('endTurn', { roomId });
            logBattle('Ход завершен - сигнал отправлен');
        };

        console.log('End Turn button handler attached');
    } else {
        console.error('End Turn button not found in DOM');
    }

    // Кнопка Surrender
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) {
        surrenderBtn.onclick = () => {
            if (confirm('Вы уверены, что хотите сдаться?')) {
                console.log('Surrender button clicked');
                socket.emit('surrender');
                logBattle('Вы сдались');
            }
        };
        console.log('Surrender button handler attached');
    }
}

function generateDicePool(round, previousOnes = 0) {
    const pool = { 1: previousOnes, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    // Бросаем количество кубиков равное номеру раунда
    for (let i = 0; i < round; i++) {
        const roll = Math.floor(Math.random() * 6) + 1;
        pool[roll]++;
    }

    return pool;
}

/** Отрисовка панели кубиков */
function renderDicePool(containerId, dicePool, playerName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Очищаем предыдущий контент
    const existingDicePanel = container.querySelector('.dice-panel');
    if (existingDicePanel) {
        existingDicePanel.remove();
    }

    // Создаем панель кубиков
    const dicePanel = document.createElement('div');
    dicePanel.className = 'dice-panel';

    // Заголовок
    const header = document.createElement('div');
    header.className = 'dice-panel-header';
    header.innerHTML = `<h4>Кубики ${playerName}</h4>`;

    // Контейнер для кубиков
    const diceContainer = document.createElement('div');
    diceContainer.className = 'dice-container';

    // Подсчет общего количества кубиков
    const totalDice = Object.values(dicePool).reduce((sum, count) => sum + count, 0);

    // Создаем слоты для каждого значения кубика
    for (let value = 1; value <= 6; value++) {
        const count = dicePool[value] || 0;

        const diceSlot = document.createElement('div');
        diceSlot.className = `dice-slot ${count > 0 ? 'has-dice' : 'empty'}`;
        diceSlot.dataset.value = value;

        // Особое оформление для единиц (специальные кубы)
        if (value === 1 && count > 0) {
            diceSlot.classList.add('special-dice');
        }

        diceSlot.innerHTML = `
            <div class="dice-face">
                <span class="dice-value">${value}</span>
                ${count > 0 ? `<span class="dice-count">${count}</span>` : ''}
            </div>
        `;

        // Добавляем подсказку
        const tooltip = value === 1
            ? 'Специальные кубы (торпеды, спецдействия)'
            : `Активация кораблей ${value}+`;
        diceSlot.title = tooltip;

        diceContainer.appendChild(diceSlot);
    }

    // Информация о пуле
    const poolInfo = document.createElement('div');
    poolInfo.className = 'dice-pool-info';
    poolInfo.innerHTML = `
        <small>Всего кубиков: ${totalDice}</small>
        ${dicePool[1] > 0 ? `<small class="special-note">Спец. кубы: ${dicePool[1]}</small>` : ''}
    `;

    dicePanel.appendChild(header);
    dicePanel.appendChild(diceContainer);
    dicePanel.appendChild(poolInfo);

    // Вставляем панель в начало контейнера (перед списком кораблей)
    container.insertBefore(dicePanel, container.firstChild);
}