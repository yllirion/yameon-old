// public/js/battleUI.js

import {
    drawHexGrid,
    renderPlacedShips,
    addRotationControls,
    showRotationControlsForShip,
    showMovementCells,
    clearMovementHighlight,
    isMovementCellAvailable,
    getSelectedShipForMovement
} from './hexmap.js';

/** Базовые характеристики по классу – используется для карточек и логов */
const classStats = {
    'Фрегат':   { speed: 5, maneuverability: 1, armor: 5, activation: 2 },
    'Эсминец':  { speed: 4, maneuverability: 1, armor: 6, activation: 3 },
    'Крейсер':  { speed: 3, maneuverability: 1, armor: 7, activation: 4 },
    'Линкор':   { speed: 2, maneuverability: 1, armor: 8, activation: 5 },
    'Дредноут': { speed: 1, maneuverability: 1, armor: 9, activation: 6 }
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

/** Обработчик поворота корабля */
function handleShipRotation(socket, roomId, shipId, direction) {
    console.log('Rotating ship:', shipId, direction);

    socket.emit('rotateShip', {
        roomId: roomId,
        shipId: shipId,
        direction: direction
    });

    logBattle(`Корабль повернут ${direction === 'left' ? 'налево' : 'направо'}`);
}

/** Настройка обработчиков кликов на корабли для выбора в фазе расстановки */
function setupShipClickHandlers(state, playerId) {
    console.log('Setting up ship click handlers for placement');

    // Добавляем обработчики кликов на корабли для показа кнопок поворота
    // В фазе placement все свои корабли кликабельны для поворота
    document.querySelectorAll('.ship-icon').forEach(shipIcon => {
        const shipId = shipIcon.dataset.shipId;
        const ship = state.ships.find(s => s.id === shipId);

        if (ship && ship.owner === playerId && state.phase === 'placement') {
            shipIcon.style.cursor = 'pointer';

            shipIcon.onclick = (e) => {
                e.stopPropagation();
                console.log('Ship clicked for rotation:', shipId);

                // Показываем кнопки поворота только для этого корабля
                showRotationControlsForShip(shipId);

                // Подсвечиваем выбранный корабль
                document.querySelectorAll('.ship-icon.selected-for-rotation').forEach(el => {
                    el.classList.remove('selected-for-rotation');
                });
                shipIcon.classList.add('selected-for-rotation');

                logBattle(`Выбран корабль для поворота: ${ship.shipClass}`);
            };
        }
    });
}

/** Настройка обработчиков кликов для боевой фазы */
function setupBattleClickHandlers(state, socket, playerId) {
    console.log('Setting up battle click handlers');

    // Обработчики кликов по кораблям в боевой фазе
    document.querySelectorAll('.ship-icon').forEach(shipIcon => {
        const shipId = shipIcon.dataset.shipId;
        const ship = state.ships.find(s => s.id === shipId);

        if (ship && ship.owner === playerId && state.currentPlayer === playerId) {
            shipIcon.style.cursor = 'pointer';

            // Левый клик - показать область движения
            shipIcon.onclick = (e) => {
                e.preventDefault();
                console.log('Left click on ship:', shipId);

                // Очищаем предыдущие выделения
                clearMovementHighlight();

                // Показываем область движения
                showMovementCells(ship, state.ships);

                // Подсвечиваем выбранный корабль
                document.querySelectorAll('.ship-icon.selected-for-movement').forEach(el => {
                    el.classList.remove('selected-for-movement');
                });
                shipIcon.classList.add('selected-for-movement');

                logBattle(`Выбран корабль для движения: ${ship.shipClass} в (${ship.position.q},${ship.position.r})`);
            };

            // Правый клик - показать область стрельбы (пока заглушка)
            shipIcon.oncontextmenu = (e) => {
                e.preventDefault();
                console.log('Right click on ship:', shipId);
                logBattle(`Область стрельбы для ${ship.shipClass} (функция в разработке)`);
            };
        }
    });

    // Обработчики кликов по гексам для движения
    document.querySelectorAll('#hexmap polygon').forEach(poly => {
        poly.onclick = (e) => {
            const q = parseInt(poly.dataset.q);
            const r = parseInt(poly.dataset.r);
            const s = parseInt(poly.dataset.s);

            console.log('Hex clicked:', { q, r, s });

            // Проверяем, доступен ли этот гекс для движения
            if (isMovementCellAvailable(q, r, s)) {
                const selectedShip = getSelectedShipForMovement();
                if (selectedShip && state.currentPlayer === playerId) {
                    console.log('Moving ship to:', { q, r, s });

                    // Отправляем команду движения на сервер
                    socket.emit('moveShip', {
                        roomId: state.id,
                        shipId: selectedShip.id,
                        targetPosition: { q, r, s }
                    });

                    // Очищаем выделение
                    clearMovementHighlight();

                    logBattle(`Корабль перемещается в (${q},${r})`);
                }
            }
        };
    });
}

/** Инициализация боевого UI */
export function initBattleUI(showView, socket, playerId) {
    console.log('Initializing battle UI for player:', playerId);

    // Добавляем CSS стили для поворота кораблей и движения
    addBattleStyles();

    // Отписываем старые слушатели
    socket.off('startGame');
    socket.off('updateGame');
    socket.off('battleState');
    socket.off('gameOver');
    socket.off('placementError');
    socket.off('turnError');
    socket.off('turnChanged');
    socket.off('movementError');

    // Обработчик ошибок расстановки
    socket.on('placementError', ({ message }) => {
        logBattle(`Ошибка: ${message}`);
    });

    // Обработчик ошибок хода
    socket.on('turnError', ({ message }) => {
        logBattle(`Ошибка хода: ${message}`);
    });

    // Обработчик ошибок движения
    socket.on('movementError', ({ message }) => {
        logBattle(`Ошибка движения: ${message}`);
    });

    // Обработчик смены хода
    socket.on('turnChanged', ({ currentPlayerNick, round }) => {
        logBattle(`Ход переходит к ${currentPlayerNick}. Раунд ${round}`);
    });

    socket.on('battleState', async state => {
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

            await renderPlacement(state, showView, socket, playerId);
        }
        else if (state.phase === 'battle') {
            // сбросим данные placement
            if (initialPlacement) {
                initialPlacement = null;
                lastShips = [];
                logBattle(`Фаза: Бой начался! Раунд ${state.round}`);
            }
            await renderBattle(state, showView, socket, playerId);
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
async function renderPlacement(state, showView, socket, playerId) {
    console.log('Rendering placement phase');

    // Загружаем проекты кораблей перед рендерингом
    await loadShipProjects();

    showView('battle');

    // Рисуем сетку и иконки уже выставленных кораблей
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);

        // Добавляем кнопки поворота для кораблей текущего игрока
        state.ships.forEach(ship => {
            if (ship.owner === playerId) {
                addRotationControls(
                    ship,
                    true,
                    true,
                    (shipId, direction) => handleShipRotation(socket, state.id, shipId, direction)
                );
            }
        });

        // Добавляем обработчики кликов на гексы и корабли
        setTimeout(() => {
            setupHexClickHandlers(state, socket, playerId);
            setupShipClickHandlers(state, playerId);
        }, 100);
    });

    // Обновляем текст хода
    const turnElement = document.getElementById('turnPlayer');
    if (turnElement) {
        const isMyTurn = state.currentPlayer === playerId;
        turnElement.textContent = isMyTurn
            ? `Ваш ход расстановки - Раунд ${state.round}`
            : `Ход расстановки соперника - Раунд ${state.round}`;
        turnElement.style.color = isMyTurn ? '#4CAF50' : '#F44336';
        turnElement.style.fontWeight = 'bold';
    }

    // Активность кнопки End Turn в фазе расстановки
    const endTurnBtn = document.getElementById('endTurnBtn');
    if (endTurnBtn) {
        const isMyTurn = state.currentPlayer === playerId;
        endTurnBtn.disabled = !isMyTurn;
        endTurnBtn.style.opacity = isMyTurn ? '1' : '0.5';
        endTurnBtn.textContent = 'End Turn';
    }

    // Рисуем списки кораблей для размещения
    renderPlacementLists(state, playerId);
}

/** Настройка обработчиков кликов на гексы для размещения */
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
            const projectInfo = getProjectInfo(projectId);

            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = 'ship-card';
                card.dataset.projectId = projectId;

                // Используем характеристики из проекта, если доступны, иначе fallback на classStats
                let displayStats = projectInfo || classStats[shipClass];

                card.innerHTML = `
                    <h4>${projectName}</h4>
                    <p class="ship-class-badge">${shipClass}</p>
                    <p>Сп:${displayStats.speed}
                       Мн:${displayStats.maneuverability}
                       Бр:${displayStats.armor}
                       Ак:${displayStats.activation}</p>
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
async function renderBattle(state, showView, socket, playerId) {
    console.log('Rendering battle phase');

    // Загружаем проекты кораблей перед рендерингом
    await loadShipProjects();

    showView('battle');

    // Сетка и иконки
    requestAnimationFrame(() => {
        drawHexGrid();
        renderPlacedShips(state.ships);

        // Добавляем обработчики для боевой фазы
        setTimeout(() => {
            setupBattleClickHandlers(state, socket, playerId);
        }, 100);
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
        endTurnBtn.textContent = 'End Turn';
    }

    // Показываем списки уже размещённых кораблей
    const myShips = state.ships.filter(s => s.owner === playerId);
    const opShips = state.ships.filter(s => s.owner !== playerId);

    // Получаем пулы кубиков из состояния
    const myDicePool = state.dicePools && state.dicePools[playerId]
        ? state.dicePools[playerId].current
        : generateDicePool(state.round, 0);

    const opponentId = Object.keys(state.dicePools || {}).find(id => id !== playerId);
    const opDicePool = state.dicePools && state.dicePools[opponentId]
        ? state.dicePools[opponentId].current
        : generateDicePool(state.round, 0);

    console.log('Dice pools:', { myDicePool, opDicePool, stateDicePools: state.dicePools });

    // Отрисовываем панели в правильном порядке
    renderBattlePanel('player1Ships', myShips, myDicePool, 'ваши');
    renderBattlePanel('player2Ships', opShips, opDicePool, 'противника');
}

/** Отрисовка боевой панели с кубиками и флотом */
function renderBattlePanel(containerId, ships, dicePool, playerName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Добавляем панель кубиков только если они есть (боевая фаза)
    if (dicePool) {
        renderDicePool(container, dicePool, playerName);
    }

    // Затем добавляем флот
    renderFleetList(container, ships);
}

/** Отрисовка панели кубиков принимает контейнер напрямую */
function renderDicePool(container, dicePool, playerName) {
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
        <small>Всего значений: ${totalDice}</small>
        ${dicePool[1] > 0 ? `<small class="special-note">Спец. значения: ${dicePool[1]}</small>` : ''}
    `;

    dicePanel.appendChild(header);
    dicePanel.appendChild(diceContainer);
    dicePanel.appendChild(poolInfo);

    container.appendChild(dicePanel);
}

/** Отрисовка списка кораблей в бою */
function renderFleetList(container, ships) {
    if (ships.length === 0) {
        const noShips = document.createElement('div');
        noShips.className = 'no-ships';
        noShips.textContent = 'Нет кораблей';
        container.appendChild(noShips);
        return;
    }

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

            // Получаем характеристики из проекта или fallback на classStats
            let displayStats = projectInfo || classStats[ship.shipClass];

            // Если у проекта есть модули, рассчитываем модифицированные характеристики
            if (projectInfo && projectInfo.modules && projectInfo.modules.length > 0) {
                displayStats = calculateModifiedStats(ship.shipClass, projectInfo.modules);
            }

            // Правильный расчет maxHP через активацию из проекта или классовых констант
            const maxHP = displayStats.activation;
            const hpPercent = (ship.hp / maxHP) * 100;
            const hpColor = hpPercent > 60 ? '#4CAF50' : hpPercent > 30 ? '#FF9800' : '#F44336';

            // Рассчитываем проценты для очков движения
            const speedPercent = ((ship.currentSpeed || ship.maxSpeed || 0) / (ship.maxSpeed || 1)) * 100;
            const maneuverPercent = ((ship.currentManeuverability || ship.maxManeuverability || 0) / (ship.maxManeuverability || 1)) * 100;

            const speedColor = speedPercent > 60 ? '#2196F3' : speedPercent > 30 ? '#FF9800' : '#F44336';
            const maneuverColor = maneuverPercent > 60 ? '#9C27B0' : maneuverPercent > 30 ? '#FF9800' : '#F44336';

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
                    <div class="movement-bars">
                        <div class="speed-bar">
                            <div class="speed-fill" style="width: ${speedPercent}%; background-color: ${speedColor}"></div>
                            <span class="speed-text">${ship.currentSpeed || ship.maxSpeed || 0}/${ship.maxSpeed || 0} Скорость</span>
                        </div>
                        <div class="maneuver-bar">
                            <div class="maneuver-fill" style="width: ${maneuverPercent}%; background-color: ${maneuverColor}"></div>
                            <span class="maneuver-text">${ship.currentManeuverability || ship.maxManeuverability || 0}/${ship.maxManeuverability || 0} Манёвр</span>
                        </div>
                    </div>
                    <div class="ship-details">
                        <span>Поз: (${ship.position.q}, ${ship.position.r})</span>
                        <span>Сп:${ship.currentSpeed || ship.maxSpeed || 0}/${ship.maxSpeed || 0} Мн:${ship.currentManeuverability || ship.maxManeuverability || 0}/${ship.maxManeuverability || 0} Бр:${displayStats.armor}</span>
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
        container.appendChild(groupContainer);
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

/** Добавляет CSS стили для поворота кораблей и движения */
function addBattleStyles() {
    // Проверяем, не добавлены ли уже стили
    if (document.getElementById('battle-styles')) {
        return;
    }

    const battleStyles = `
    .ship-icon.selected-for-rotation {
        filter: drop-shadow(0 0 8px #FFD700) !important;
    }
    
    .ship-icon.selected-for-movement {
        filter: drop-shadow(0 0 8px #00FF00) !important;
    }

    .rotation-button:hover circle {
        fill: #1976D2 !important;
        stroke-width: 3;
    }

    .rotation-button:hover text {
        font-size: 16px !important;
    }

    .rotation-button {
        transition: all 0.2s ease;
        cursor: pointer;
    }
    
    .rotation-button circle {
        transition: all 0.2s ease;
    }
    
    .rotation-button text {
        transition: all 0.2s ease;
        pointer-events: none;
    }
    
    .rotation-button:active circle {
        fill: #0D47A1 !important;
    }
    
    #hexmap polygon.movement-available {
        fill: rgba(52,211,153,0.3) !important;
        stroke: #34d399 !important;
        stroke-width: 2 !important;
        cursor: pointer !important;
    }
    
    #hexmap polygon.movement-available:hover {
        fill: rgba(52,211,153,0.5) !important;
    }
    
    .ship-icon {
        cursor: pointer;
    }
    
    .ship-icon:hover {
        filter: brightness(1.1);
    }
    `;

    // Создаем и добавляем элемент style
    const styleSheet = document.createElement('style');
    styleSheet.id = 'battle-styles';
    styleSheet.textContent = battleStyles;
    document.head.appendChild(styleSheet);

    console.log('Battle styles added');
}