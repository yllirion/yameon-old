// public/js/battleUI.js

import {
    drawHexGrid,
    renderPlacedShips,
    addRotationControls,
    showRotationControlsForShip,
    showMovementCells,
    clearMovementHighlight,
    isMovementCellAvailable,
    getSelectedShipForMovement,
    cubeAdd,              // НОВЫЙ импорт
    cubeDistance,         // НОВЫЙ импорт
    CUBE_DIRECTIONS      // НОВЫЙ импорт
} from './hexmap.js';

import { initCombatSystem, testCombatSystem, setCombatRoomId } from './combat.js';
import { setCombatDependencies } from './combat.js';

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
let lastBattleState = null;
let currentPlayerId = null;
let globalSocket = null;

// Кэш для проектов кораблей
let shipProjectsCache = {};

let previewState = {
    isPreviewMode: false,
    shipId: null,
    originalPosition: null,
    originalDirection: null,
    originalSpeed: null,
    originalManeuverability: null,
    originalFreeTurn: null,
    movements: [] // История движений для визуализации
};

/** Пишет сообщение в лог снизу в #battleLog */
function logBattle(msg) {
    const footer = document.getElementById('battleLog');
    if (!footer) return;
    const div = document.createElement('div');
    div.textContent = msg;
    footer.appendChild(div);
    footer.scrollTop = footer.scrollHeight;
}

function getDirectionToTarget(from, to) {
    const diff = cubeAdd(to, { q: -from.q, r: -from.r, s: -from.s });

    console.log(`Direction from (${from.q},${from.r}) to (${to.q},${to.r})`);
    console.log(`Diff vector: (${diff.q}, ${diff.r}, ${diff.s})`);

    // Находим ближайшее направление
    let bestDir = 0;
    let bestDot = -2;

    for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRECTIONS[i];
        const dot = diff.q * dir.q + diff.r * dir.r + diff.s * dir.s;

        if (dot > bestDot) {
            bestDot = dot;
            bestDir = i;
        }
    }

    return bestDir;
}



// Локальное движение корабля (без сервера)
function moveShipLocally(ship, targetPosition, allShips) {
    // Рассчитываем стоимость движения
    const pathCost = calculateLocalPathCost(ship, targetPosition, allShips);

    if (!pathCost) {
        logBattle('Недоступная позиция');
        return;
    }

    if (ship.currentSpeed < pathCost.speedCost) {
        logBattle('Недостаточно очков скорости');
        return;
    }

    if (ship.currentManeuverability < pathCost.maneuverCost) {
        logBattle('Недостаточно очков маневренности');
        return;
    }

    // Сохраняем движение в историю
    previewState.movements.push({
        from: { ...ship.position },
        to: { ...targetPosition },
        direction: pathCost.finalDirection,
        speedCost: pathCost.speedCost,
        maneuverCost: pathCost.maneuverCost
    });

    // Обновляем позицию локально
    ship.position = targetPosition;
    ship.dir = pathCost.finalDirection;
    ship.currentSpeed -= pathCost.speedCost;
    ship.currentManeuverability -= pathCost.maneuverCost;

    // Даем бесплатный поворот если двигались
    if (pathCost.speedCost > 0) {
        ship.hasFreeTurn = true;
    }

    // Перерисовываем корабль
    updateShipVisuals(ship);

    // Обновляем область движения
    setTimeout(() => {
        showMovementCells(ship, allShips);

        // ВАЖНО: Показываем кнопки поворота если есть возможность
        if (ship.currentManeuverability > 0 || ship.hasFreeTurn) {
            console.log('Adding rotation controls in preview mode');
            addRotationControls(
                ship,
                true,  // isCurrentPlayer
                false, // isPlacementPhase
                (shipId, direction) => handlePreviewRotation(shipId, direction)
            );
            showRotationControlsForShip(ship.id);
        }
    }, 100);

    logBattle(`Предпросмотр: переход в (${targetPosition.q},${targetPosition.r})`);
}

function handlePreviewRotation(shipId, direction) {
    const ship = lastBattleState.ships.find(s => s.id === shipId);
    if (!ship) return;

    // Определяем стоимость поворота
    let maneuverCost = 1;
    if (ship.hasFreeTurn) {
        maneuverCost = 0;
        ship.hasFreeTurn = false;
        logBattle(`Поворот ${direction === 'left' ? 'налево' : 'направо'} (бесплатный)`);
    } else if (ship.currentManeuverability > 0) {
        ship.currentManeuverability -= 1;
        logBattle(`Поворот ${direction === 'left' ? 'налево' : 'направо'} (−1 манёвренность)`);
    } else {
        logBattle('Недостаточно очков маневренности');
        return;
    }

    // Поворачиваем корабль локально
    if (direction === 'left') {
        ship.dir = (ship.dir + 5) % 6;
    } else if (direction === 'right') {
        ship.dir = (ship.dir + 1) % 6;
    }

    // Сохраняем поворот в историю
    previewState.movements.push({
        type: 'rotation',
        direction: direction,
        maneuverCost: maneuverCost
    });

    // Обновляем визуально
    updateShipVisuals(ship);

    // Обновляем кнопки поворота
    setTimeout(() => {
        if (ship.currentManeuverability > 0 || ship.hasFreeTurn) {
            addRotationControls(
                ship,
                true,
                false,
                (shipId, direction) => handlePreviewRotation(shipId, direction)
            );
            showRotationControlsForShip(ship.id);
        }
    }, 100);
}

function enterPreviewMode(ship) {
    console.log('Entering preview mode for ship:', ship.id);

    // Проверяем, что корабль может быть активирован
    if (ship.status !== 'ready') {
        console.log('Ship is not ready, cannot enter preview mode');
        return;
    }

    // Если уже в режиме предпросмотра другого корабля - сначала сбрасываем
    if (previewState.isPreviewMode && previewState.shipId !== ship.id) {
        console.log('Already in preview mode for another ship, resetting first');
        resetPreviewMode();
    }

    // Сохраняем исходное состояние корабля
    previewState = {
        isPreviewMode: true,
        shipId: ship.id,
        originalPosition: {
            q: ship.position.q,
            r: ship.position.r,
            s: ship.position.s
        },
        originalDirection: ship.dir,
        originalSpeed: ship.currentSpeed,
        originalManeuverability: ship.currentManeuverability,
        originalFreeTurn: ship.hasFreeTurn || false,
        movements: [] // История движений для возможной визуализации маршрута
    };

    console.log('Preview state saved:', previewState);

    // Показываем визуальный индикатор режима предпросмотра
    showPreviewIndicator();

    // Добавляем защиту от контекстного меню на всю карту
    const hexmap = document.getElementById('hexmap');
    if (hexmap) {
        hexmap.addEventListener('contextmenu', preventContextMenu, true);
    }

    // Добавляем специальный класс для визуального выделения корабля в режиме предпросмотра
    const shipIcon = document.querySelector(`.ship-icon[data-ship-id="${ship.id}"]`);
    if (shipIcon) {
        shipIcon.classList.add('preview-mode');
    }

    // Обновляем карточку корабля с индикатором предпросмотра
    const container = document.getElementById('playerShipCard');
    if (container && container.dataset.shipId === ship.id) {
        const card = container.querySelector('.ship-hover-card');
        if (card) {
            // Добавляем индикатор в карточку
            if (!card.querySelector('.preview-mode-indicator')) {
                const indicator = document.createElement('div');
                indicator.className = 'preview-mode-indicator';
                indicator.innerHTML = '🔍 Режим предпросмотра';
                indicator.style.cssText = `
                    background: #FF9800;
                    color: white;
                    padding: 4px 8px;
                    text-align: center;
                    font-size: 0.8em;
                    font-weight: bold;
                    margin-bottom: 4px;
                `;
                card.insertBefore(indicator, card.firstChild);
            }
        }
    }

    // Проверяем доступность кубиков для активации
    const canActivate = checkIfCanActivateShip(ship);
    if (!canActivate) {
        logBattle(`⚠️ Внимание: нет подходящих кубов для активации ${ship.shipClass}`);
    }

    logBattle(`🔍 Режим предпросмотра: ${ship.shipClass} - нажмите ESC для отмены`);
}

function checkIfCanActivateShip(ship) {
    if (!lastBattleState || !lastBattleState.dicePools) return false;

    const playerDice = lastBattleState.dicePools[currentPlayerId];
    if (!playerDice || !playerDice.current) return false;

    const activationValue = classStats[ship.shipClass].activation;

    // Проверяем наличие подходящих кубов
    for (let value = activationValue; value <= 6; value++) {
        if (playerDice.current[value] && playerDice.current[value] > 0) {
            return true;
        }
    }

    return false;
}

function preventContextMenu(e) {
    if (previewState.isPreviewMode) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
}


function commitPreviewMode() {
    if (!previewState.isPreviewMode) return;

    const ship = lastBattleState.ships.find(s => s.id === previewState.shipId);
    if (!ship) return;

    console.log('Committing preview mode');

    // Сохраняем финальную позицию и направление для отправки на сервер
    const finalPosition = { ...ship.position };
    const finalDirection = ship.dir;

    // Рассчитываем общую стоимость всего маршрута
    let totalSpeedCost = previewState.originalSpeed - ship.currentSpeed;
    let totalManeuverCost = previewState.originalManeuverability - ship.currentManeuverability;

    console.log('Total movement cost:', {
        speed: totalSpeedCost,
        maneuver: totalManeuverCost,
        movements: previewState.movements.length
    });

    // Убираем защиту от контекстного меню
    const hexmap = document.getElementById('hexmap');
    if (hexmap) {
        hexmap.removeEventListener('contextmenu', preventContextMenu);
    }

    // Скрываем индикатор
    hidePreviewIndicator();

    // Сбрасываем флаг режима предпросмотра
    previewState.isPreviewMode = false;

    // Если корабль еще не активирован - активируем
    if (ship.status === 'ready') {
        const roomId = currentBattleRoomId || lastBattleState.id;

        if (!autoActivateShip(ship.id, roomId, globalSocket)) {
            // Не удалось активировать - откатываем все изменения
            console.log('Failed to activate ship, rolling back');

            // Восстанавливаем исходное состояние
            ship.position = previewState.originalPosition;
            ship.dir = previewState.originalDirection;
            ship.currentSpeed = previewState.originalSpeed;
            ship.currentManeuverability = previewState.originalManeuverability;
            ship.hasFreeTurn = previewState.originalFreeTurn;

            // Перерисовываем в исходной позиции
            updateShipVisuals(ship);
            showMovementCells(ship, lastBattleState.ships);

            logBattle(`Нет подходящих кубов для активации - движение отменено`);
            return;
        }
    }

    // Отправляем финальную позицию на сервер
    // Задержка нужна, чтобы активация успела обработаться на сервере
    setTimeout(() => {
        const roomId = currentBattleRoomId || lastBattleState.id;

        // Если позиция изменилась - отправляем движение
        if (finalPosition.q !== previewState.originalPosition.q ||
            finalPosition.r !== previewState.originalPosition.r ||
            finalPosition.s !== previewState.originalPosition.s ||
            finalDirection !== previewState.originalDirection) {

            globalSocket.emit('moveShip', {
                roomId: roomId,
                shipId: ship.id,
                targetPosition: finalPosition
            });

            logBattle(`Позиция зафиксирована: (${finalPosition.q},${finalPosition.r})`);
        } else {
            logBattle(`Корабль активирован без перемещения`);
        }
    }, 150);

    // Очищаем состояние предпросмотра
    previewState = {
        isPreviewMode: false,
        shipId: null,
        originalPosition: null,
        originalDirection: null,
        originalSpeed: null,
        originalManeuverability: null,
        originalFreeTurn: null,
        movements: []
    };
}

function resetPreviewMode() {
    if (!previewState.isPreviewMode) return;

    const ship = lastBattleState.ships.find(s => s.id === previewState.shipId);
    if (!ship) return;

    console.log('Resetting preview mode');

    // Восстанавливаем исходное состояние корабля
    ship.position = previewState.originalPosition;
    ship.dir = previewState.originalDirection;
    ship.currentSpeed = previewState.originalSpeed;
    ship.currentManeuverability = previewState.originalManeuverability;
    ship.hasFreeTurn = previewState.originalFreeTurn;

    // Перерисовываем корабль в исходной позиции
    updateShipVisuals(ship);

    // Очищаем подсветку движения
    clearMovementHighlight();

    // Показываем область движения для исходной позиции
    setTimeout(() => {
        showMovementCells(ship, lastBattleState.ships);
    }, 100);

    // Убираем защиту от контекстного меню
    const hexmap = document.getElementById('hexmap');
    if (hexmap) {
        hexmap.removeEventListener('contextmenu', preventContextMenu);
    }

    // Убираем индикатор режима предпросмотра
    hidePreviewIndicator();

    // Сбрасываем состояние предпросмотра
    previewState = {
        isPreviewMode: false,
        shipId: null,
        originalPosition: null,
        originalDirection: null,
        originalSpeed: null,
        originalManeuverability: null,
        originalFreeTurn: null,
        movements: []
    };

    logBattle(`Предпросмотр отменен - корабль возвращен в исходную позицию`);
}



// Обработчик ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewState.isPreviewMode) {
        e.preventDefault();
        resetPreviewMode();
    }
});

function showPreviewIndicator() {
    let indicator = document.getElementById('previewIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'previewIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 165, 0, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(indicator);
    }
    indicator.innerHTML = '🔍 РЕЖИМ ПРЕДПРОСМОТРА - ESC для отмены';
}

function hidePreviewIndicator() {
    const indicator = document.getElementById('previewIndicator');
    if (indicator) indicator.remove();
}


// В battleUI.js обновить функцию updateShipVisuals:

function updateShipVisuals(ship) {
    console.log('Updating ship visuals for:', ship.id);

    // Сохраняем текущее состояние выделения
    const wasSelected = document.querySelector(`.ship-icon[data-ship-id="${ship.id}"]`)?.classList.contains('selected-for-movement');

    // Обновляем позицию и поворот корабля на карте
    renderPlacedShips(lastBattleState.ships, currentPlayerId);

    // ВАЖНО: После перерисовки нужно восстановить обработчики событий
    setTimeout(() => {
        const shipIcon = document.querySelector(`.ship-icon[data-ship-id="${ship.id}"]`);
        if (!shipIcon) return;

        // Восстанавливаем выделение
        if (wasSelected) {
            shipIcon.classList.add('selected-for-movement');
        }

        // Восстанавливаем обработчики кликов
        setupShipEventHandlers(shipIcon, ship);
    }, 50);
}

function setupShipEventHandlers(shipIcon, ship) {
    // Удаляем старые обработчики
    const newIcon = shipIcon.cloneNode(true);
    shipIcon.parentNode.replaceChild(newIcon, shipIcon);
    shipIcon = newIcon;

    // Определяем контейнер для карточки
    const cardContainerId = ship.owner === currentPlayerId ? 'playerShipCard' : 'enemyShipCard';

    // Восстанавливаем HOVER обработчики
    newIcon.addEventListener('mouseenter', () => {
        const container = document.getElementById(cardContainerId);
        if (container && !container.dataset.fixed) {
            container.innerHTML = '';
            // Получаем актуальные данные корабля
            const currentShip = lastBattleState.ships.find(s => s.id === ship.id);
            if (currentShip) {
                container.appendChild(createShipCard(currentShip, false));
            }
        }
    });

    newIcon.addEventListener('mouseleave', () => {
        const container = document.getElementById(cardContainerId);
        if (container && !container.dataset.fixed) {
            container.innerHTML = '';
        }
    });

    // Обработчики кликов только для своих кораблей
    if (ship.owner === currentPlayerId) {
        let clickTimer = null;
        let clickCount = 0;

        // Обработчик кликов
        newIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    handleSingleClick(ship, ship.id, lastBattleState, globalSocket);
                    clickCount = 0;
                }, 250);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                handleDoubleClick(ship, ship.id, lastBattleState, globalSocket);
            }
        });

        // Правый клик только для своих кораблей
        newIcon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentShip = lastBattleState.ships.find(s => s.id === ship.id);
            if (currentShip) {
                handleRightClick(currentShip, currentShip.id, lastBattleState, globalSocket);
            }
            return false;
        });

        newIcon.oncontextmenu = () => false;
    }
}

function calculateLocalPathCost(ship, targetPosition, allShips) {
    const distance = cubeDistance(ship.position, targetPosition);

    // Простая проверка - можем ли дойти
    if (distance > ship.currentSpeed) return null;

    // Расчет поворота
    let maneuverCost = 0;
    if (distance > 0) {
        const targetDirection = getDirectionToTarget(ship.position, targetPosition);
        const directionDiff = Math.abs(targetDirection - ship.dir);
        const actualDiff = Math.min(directionDiff, 6 - directionDiff);

        if (actualDiff > 0 && !ship.hasFreeTurn) {
            maneuverCost = actualDiff; // Упрощенно - 1 MP за каждые 60°
        }
    }

    return {
        speedCost: distance,
        maneuverCost: maneuverCost,
        finalDirection: distance > 0 ? getDirectionToTarget(ship.position, targetPosition) : ship.dir
    };
}

function handleSingleClick(ship, shipId, state, socket) {
    // Если мы в режиме предпросмотра другого корабля - сбрасываем
    if (previewState.isPreviewMode && previewState.shipId !== shipId) {
        resetPreviewMode();
    }

    // Очищаем предыдущие выделения
    clearMovementHighlight();

    // Показываем область движения
    showMovementCells(ship, state.ships);

    // Подсвечиваем выбранный корабль
    document.querySelectorAll('.ship-icon.selected-for-movement').forEach(el => {
        el.classList.remove('selected-for-movement');
    });
    document.querySelector(`.ship-icon[data-ship-id="${shipId}"]`).classList.add('selected-for-movement');

    // Показываем карточку корабля
    const container = document.getElementById('playerShipCard');
    if (container) {
        container.innerHTML = '';
        container.appendChild(createShipCard(ship, true));
        container.dataset.fixed = 'true';
        container.dataset.shipId = shipId;
    }

    // Показываем кнопки поворота
    // В предпросмотре - с особым обработчиком
    if (previewState.isPreviewMode && previewState.shipId === shipId) {
        if (ship.currentManeuverability > 0 || ship.hasFreeTurn) {
            addRotationControls(
                ship,
                true,
                false,
                (shipId, direction) => handlePreviewRotation(shipId, direction)
            );
            showRotationControlsForShip(shipId);
        }
    } else if (ship.status === 'activated' && (ship.currentManeuverability > 0 || ship.hasFreeTurn)) {
        // Обычный режим
        addRotationControls(
            ship,
            true,
            false,
            (shipId, direction) => handleCombatRotation(socket, state.id, shipId, direction, ship)
        );
        showRotationControlsForShip(shipId);
    }

    logBattle(`Выбран корабль: ${ship.shipClass}`);
}

function handleDoubleClick(ship, shipId, state, socket) {
    console.log('handleDoubleClick called:', {
        shipId: shipId,
        shipStatus: ship.status,
        shipClass: ship.shipClass,
        currentBattleRoomId: currentBattleRoomId,
        stateId: state.id
    });

    if (ship.status === 'ready') {
        // Используем state.id вместо currentBattleRoomId
        const roomId = state.id || currentBattleRoomId;

        console.log('Attempting to activate ship with roomId:', roomId);

        // Пытаемся активировать корабль
        if (autoActivateShip(shipId, roomId, socket)) {
            logBattle(`Активация ${ship.shipClass}...`);

            // Если мы были в режиме предпросмотра - фиксируем позицию
            if (previewState.isPreviewMode && previewState.shipId === shipId) {
                setTimeout(() => {
                    commitPreviewMode();
                }, 100);
            }
        } else {
            logBattle(`Нет подходящих кубов для активации ${ship.shipClass}`);
        }
    } else {
        logBattle(`Корабль уже ${ship.status === 'activated' ? 'активирован' : 'сходил'}`);
    }
}

function handleRightClick(ship, shipId, state, socket) {
    console.log('Right click on ship:', shipId, 'Preview mode:', previewState.isPreviewMode);

    // В режиме предпросмотра для неактивированного корабля
    if (previewState.isPreviewMode && previewState.shipId === shipId && ship.status === 'ready') {
        logBattle('Активация корабля для стрельбы...');

        // Сначала активируем корабль
        const roomId = state.id || currentBattleRoomId;
        if (autoActivateShip(shipId, roomId, socket)) {
            // Фиксируем позицию
            setTimeout(() => {
                commitPreviewMode();
                // Ждем обновления состояния и показываем арку стрельбы
                setTimeout(() => {
                    const updatedShip = lastBattleState.ships.find(s => s.id === shipId);
                    if (updatedShip && updatedShip.status === 'activated') {
                        testCombatSystem(updatedShip, lastBattleState.ships);
                    }
                }, 300);
            }, 100);
        } else {
            logBattle('Нет подходящих кубов для активации');
        }
    } else {
        // Обычный режим стрельбы для активированного корабля
        console.log('Normal combat mode for ship:', ship);
        testCombatSystem(ship, state.ships || lastBattleState.ships);
    }
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

    // Обработчики кликов по кораблям
    document.querySelectorAll('.ship-icon').forEach(shipIcon => {
        const shipId = shipIcon.dataset.shipId;
        const ship = state.ships.find(s => s.id === shipId);

        if (!ship) return;


        if (ship && ship.owner === playerId && state.currentPlayer === playerId) {
            shipIcon.style.cursor = 'pointer';

            // Удаляем старые обработчики, чтобы избежать дублирования
            const newIcon = shipIcon.cloneNode(true);
            shipIcon.parentNode.replaceChild(newIcon, shipIcon);
            shipIcon = newIcon;

            let clickTimer = null;
            let clickCount = 0;

            // Универсальный обработчик кликов
            shipIcon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                clickCount++;
                console.log(`Click ${clickCount} on ship ${shipId}`);

                if (clickCount === 1) {
                    // Первый клик - ждем возможного второго
                    clickTimer = setTimeout(() => {
                        // Одиночный клик
                        console.log('Processing single click');
                        handleSingleClick(ship, shipId, state, socket);
                        clickCount = 0;
                    }, 250); // 250мс на двойной клик

                } else if (clickCount === 2) {
                    // Двойной клик
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    console.log('Processing double click');
                    handleDoubleClick(ship, shipId, state, socket);
                }
            });

            // Правый клик остается отдельным
            shipIcon.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                console.log('Processing right click');
                handleRightClick(ship, shipId, state, socket);
            });

            console.log(`Click handlers set up for ship ${shipId}`);
        }
    });

    // Обработчики кликов по гексам для движения
    document.querySelectorAll('#hexmap polygon').forEach(poly => {
        poly.onclick = (e) => {
            const q = parseInt(poly.dataset.q);
            const r = parseInt(poly.dataset.r);
            const s = parseInt(poly.dataset.s);

            if (!isMovementCellAvailable(q, r, s)) return;

            const selectedShip = getSelectedShipForMovement();
            if (!selectedShip || state.currentPlayer !== playerId) return;

            // НОВАЯ ЛОГИКА: одиночный клик для движения
            if (selectedShip.status === 'ready') {
                // Входим в режим предпросмотра при первом движении
                if (!previewState.isPreviewMode) {
                    enterPreviewMode(selectedShip);
                }

                // Двигаем корабль локально (без отправки на сервер)
                moveShipLocally(selectedShip, { q, r, s }, state.ships);

            } else if (selectedShip.status === 'activated') {
                // Активированный корабль - обычное движение
                socket.emit('moveShip', {
                    roomId: state.id,
                    shipId: selectedShip.id,
                    targetPosition: { q, r, s }
                });
                logBattle(`Корабль перемещается в (${q},${r})`);
            }
        };
    });
}

/** Инициализация боевого UI */


export function initBattleUI(showView, socket, playerId) {
    globalSocket = socket; // Сохраняем socket глобально
    currentPlayerId = playerId;
    console.log('Initializing battle UI for player:', playerId);


    // Добавляем CSS стили для поворота кораблей и движения
    addBattleStyles();

    initCombatSystem(socket, playerId);

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
    socket.on('turnChanged', ({ currentPlayer, currentPlayerNick, round }) => {
        logBattle(`Ход переходит к ${currentPlayerNick}. Раунд ${round}`);

        // Показываем уведомление если это наш ход
        if (currentPlayer === currentPlayerId) {
            showTurnNotification('Ваш ход!');
        }
    });

    socket.on('battleState', async state => {
        console.log('[battleState received]', state);

        lastBattleState = state;
        currentBattleRoomId = state.id;
        setCombatDependencies(state, playerId, autoActivateShip);

        setCombatRoomId(state.id)

        if (state.ships) {
            console.log('=== SHIPS MOVEMENT POINTS UPDATE ===');
            state.ships.forEach(ship => {
                console.log(`Ship ${ship.id} (${ship.shipClass}):`);
                console.log(`  Speed: ${ship.currentSpeed}/${ship.maxSpeed}`);
                console.log(`  Maneuverability: ${ship.currentManeuverability}/${ship.maxManeuverability}`);
                console.log(`  Position: (${ship.position.q}, ${ship.position.r}, ${ship.position.s})`);
                console.log(`  Direction: ${ship.dir}`);
            });
            console.log('=== END SHIPS UPDATE ===');
        }

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

    socket.on('gameOver', (data) => {
        console.log('gameOver received:', data); // ДОБАВИТЬ ЭТО

        // Новый формат - победа по уничтожению всех кораблей
        if (data.winners && data.losers) {
            logBattle(`🏆 Победа ${data.winners.join(', ')}!`);
            logBattle(`💀 ${data.losers.join(', ')} - все корабли уничтожены`);
        }
        // Старый формат - сдача
        else if (data.loser) {
            logBattle(`Игрок ${data.loser} сдался — игра окончена`);
        }

        console.log('Returning to lobby...'); // И ЭТО

        // В любом случае возвращаемся в лобби
        setTimeout(() => {
            alert('Игра окончена!');
            showView('lobby');
        }, 2000);
    });

    socket.on('shipActivated', ({ shipId, shipClass, playerNick, diceValue }) => {
        logBattle(`${playerNick} активировал ${shipClass} кубиком ${diceValue}`);
    });

    socket.on('combatResults', (data) => {
        console.log('Combat results:', data);
        displayCombatResults(data);
    });

    socket.on('combatError', ({ message }) => {
        logBattle(`Ошибка боя: ${message}`);
    });

    socket.on('activationError', ({ message }) => {
        logBattle(`Ошибка активации: ${message}`);
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
        drawHexGrid('placement', state.currentPlayer, playerId);
        renderPlacedShips(state.ships, playerId);

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
        renderPlacedShips(state.ships, playerId);

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

    console.log(`Rendering battle panel for ${playerName}:`, {
        shipsCount: ships.length,
        ships: ships.map(s => ({
            id: s.id,
            class: s.shipClass,
            currentSpeed: s.currentSpeed,
            currentManeuverability: s.currentManeuverability,
            hp: s.hp
        }))
    });

    container.innerHTML = '';
    //container.offsetHeight; //Тест: попытка явно перерисовать игровое поле

    console.log(`Rendering battle panel for ${playerName}:`, {
        shipsCount: ships.length,
        ships: ships.map(s => ({
            id: s.id,
            class: s.shipClass,
            currentSpeed: s.currentSpeed,
            currentManeuverability: s.currentManeuverability
        }))
    });

    // Добавляем панель кубиков только если они есть (боевая фаза)
    if (dicePool) {
        renderDicePool(container, dicePool, playerName);
    }

    // Затем добавляем флот
    //renderFleetList(container, ships);
    const cardContainer = document.createElement('div');
    cardContainer.id = playerName === 'ваши' ? 'playerShipCard' : 'enemyShipCard';
    cardContainer.className = 'ship-hover-card-container';
    container.appendChild(cardContainer);
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

        if (count > 0 && container.id === 'player1Ships') {
            diceSlot.style.cursor = 'pointer';
            diceSlot.onclick = () => handleDiceClick(value);
        }

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

let selectedDiceValue = null;

function handleDiceClick(diceValue) {
    console.log('Dice clicked:', diceValue);

    // Убираем предыдущее выделение
    document.querySelectorAll('.dice-slot.selected').forEach(slot => {
        slot.classList.remove('selected');
    });

    // Выделяем выбранный кубик
    const clickedSlot = document.querySelector(`.dice-slot[data-value="${diceValue}"]`);
    if (clickedSlot) {
        clickedSlot.classList.add('selected');
    }

    selectedDiceValue = diceValue;

    // Подсвечиваем корабли, которые можно активировать этим кубиком
    highlightActivatableShips(diceValue);

    logBattle(`Выбран кубик: ${diceValue}`);
}

function highlightActivatableShips(diceValue) {
    document.querySelectorAll('.battle-ship-card').forEach(card => {
        card.classList.remove('can-activate');
    });

    // Находим корабли, которые можно активировать
    const ships = lastBattleState.ships.filter(ship =>
        ship.owner === currentPlayerId &&  // <-- исправлено
        ship.status === 'ready' &&
        ship.hp > 0
    );

    ships.forEach(ship => {
        const activationValue = classStats[ship.shipClass].activation;
        if (diceValue >= activationValue) {
            const card = document.querySelector(`.battle-ship-card[data-ship-id="${ship.id}"]`);
            if (card) {
                card.classList.add('can-activate');
            }
        }
    });
}

function autoActivateShip(shipId, roomId, socket) {
    console.log('autoActivateShip called:', { shipId, roomId });

    const ship = lastBattleState.ships.find(s => s.id === shipId);
    if (!ship || ship.status !== 'ready') {
        console.log('Ship not found or not ready');
        return false;
    }

    const playerDice = lastBattleState.dicePools[currentPlayerId];
    if (!playerDice) {
        console.log('No dice pool for player');
        return false;
    }

    const activationValue = classStats[ship.shipClass].activation;
    console.log(`Ship ${ship.shipClass} needs ${activationValue}+`);
    console.log('Available dice:', playerDice.current);

    // Ищем минимальный подходящий куб
    for (let value = activationValue; value <= 6; value++) {
        if (playerDice.current[value] && playerDice.current[value] > 0) {
            console.log(`Found suitable dice: ${value}`);
            socket.emit('activateShip', {
                roomId: roomId,
                shipId: shipId,
                diceValue: value
            });
            return true;
        }
    }

    console.log('No suitable dice found');
    logBattle(`Нет подходящих кубов для активации ${ship.shipClass} (нужен ${activationValue}+)`);
    return false;
}

function handleCombatRotation(socket, roomId, shipId, direction, ship) {
    // Проверяем, есть ли бесплатный поворот
    if (ship.hasFreeTurn) {
        console.log('Using free turn for rotation');
        logBattle(`Поворот ${direction === 'left' ? 'налево' : 'направо'} (бесплатный поворот после движения)`);
    } else {
        // Проверяем достаточно ли очков маневренности
        if (ship.currentManeuverability <= 0) {
            logBattle('Недостаточно очков маневренности для поворота');
            return;
        }
        logBattle(`Поворот ${direction === 'left' ? 'налево' : 'направо'} (−1 манёвренность)`);
    }

    console.log('Combat rotation:', { shipId, direction, hasFreeTurn: ship.hasFreeTurn });

    // Отправляем команду поворота на сервер
    socket.emit('combatRotateShip', {
        roomId: roomId,
        shipId: shipId,
        direction: direction
    });
}

/** Отрисовка списка кораблей в бою */
function renderFleetList(container, ships, battleState, socket) {
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
            shipCard.className = 'battle-ship-card';
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
            const speedPercent = (ship.currentSpeed / ship.maxSpeed) * 100;
            const maneuverPercent = (ship.currentManeuverability / ship.maxManeuverability) * 100;

            const speedColor = speedPercent > 60 ? '#2196F3' : speedPercent > 30 ? '#FF9800' : '#F44336';
            const maneuverColor = maneuverPercent > 60 ? '#9C27B0' : maneuverPercent > 30 ? '#FF9800' : '#F44336';
            const currentArmor = displayStats.armor - (ship.armorPenalty || 0);

            // Определяем статус корабля
            const shipStatus = ship.status || (ship.hp > 0 ? 'ready' : 'destroyed');
            const statusText = {
                'ready': 'Готов',
                'activated': 'Активирован',
                'spent': 'Сходил',
                'destroyed': 'Уничтожен'
            };
            const statusClass = {
                'ready': 'ready',
                'activated': 'active',
                'spent': 'spent',
                'destroyed': 'destroyed'
            };

            // Определяем кликабельность карточки
            const isClickable = ship.owner === currentPlayerId &&
                lastBattleState && lastBattleState.currentPlayer === currentPlayerId &&
                shipStatus === 'ready';

            if (isClickable) {
                shipCard.classList.add('clickable');
            }

            shipCard.innerHTML = `
                <div class="ship-card-header">
                    <span class="ship-name">${projectName} #${index + 1}</span>
                    <span class="ship-class-badge">${shipClass}</span>
                    <span class="ship-status ${statusClass[shipStatus]}">${statusText[shipStatus]}</span>
                </div>
                <div class="ship-stats">
                    <div class="hp-bar">
                        <div class="hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor}"></div>
                        <span class="hp-text">${ship.hp}/${maxHP} HP</span>
                    </div>
                    <div class="movement-bars">
                        <div class="speed-bar">
                            <div class="speed-fill" style="width: ${speedPercent}%; background-color: ${speedColor}"></div>
                            <span class="speed-text">${ship.currentSpeed}/${ship.maxSpeed} Скорость</span>
                        </div>
                        <div class="maneuver-bar">
                            <div class="maneuver-fill" style="width: ${maneuverPercent}%; background-color: ${maneuverColor}"></div>
                            <span class="maneuver-text">${ship.currentManeuverability}/${ship.maxManeuverability} Манёвр</span>
                        </div>
                    </div>
                    <div class="ship-details">
                        <span>Поз: (${ship.position.q}, ${ship.position.r})</span>
                        <span>Бр:${displayStats.armor}${ship.armorPenalty ? ` (-${ship.armorPenalty})` : ''}</span>
                    </div>
                    ${projectInfo && projectInfo.modules && projectInfo.modules.length > 0 ?
                `<div class="ship-modules">
                            <small>Модули: ${projectInfo.modules.map(m => m.name).join(', ')}</small>
                        </div>` : ''
            }
                </div>
            `;

            // Клик по карточке корабля - только если кликабельна
            if (isClickable) {
                shipCard.onclick = () => {
                    // Если выбран кубик и корабль ready - активируем
                    if (selectedDiceValue && shipStatus === 'ready') {
                        const activationValue = displayStats.activation;

                        if (selectedDiceValue >= activationValue) {
                            globalSocket.emit('activateShip', {
                                roomId: currentBattleRoomId,
                                shipId: ship.id,
                                diceValue: selectedDiceValue
                            });

                            // Сбрасываем выбор кубика
                            selectedDiceValue = null;
                            document.querySelectorAll('.dice-slot.selected').forEach(slot => {
                                slot.classList.remove('selected');
                            });

                            logBattle(`Активирую ${projectName} кубиком ${selectedDiceValue}`);
                        } else {
                            logBattle(`Недостаточное значение кубика для активации ${shipClass}`);
                        }
                    } else {
                        // Обычное выделение корабля
                        document.querySelectorAll('.battle-ship-card.selected')
                            .forEach(c => c.classList.remove('selected'));
                        shipCard.classList.add('selected');
                        highlightShipOnMap(ship.id);
                        logBattle(`Выбран ${projectName} #${index + 1}`);
                    }
                };
            }

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

function showTurnNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'turn-notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    // Удаляем через 3 секунды
    setTimeout(() => {
        notification.remove();
    }, 3000);
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

function createShipCard(ship, isDetailed = false) {
    const projectInfo = getProjectInfo(ship.projectId);
    const projectName = getProjectName(ship.projectId);
    const stats = projectInfo || classStats[ship.shipClass];

    const maxHP = stats.activation;
    const hpPercent = (ship.hp / maxHP) * 100;
    const speedPercent = (ship.currentSpeed / ship.maxSpeed) * 100;
    const maneuverPercent = (ship.currentManeuverability / ship.maxManeuverability) * 100;

    const card = document.createElement('div');
    card.className = 'ship-hover-card';
    card.innerHTML = `
        <div class="ship-card-header">
            <span class="ship-name">${projectName}</span>
            <span class="ship-class-badge">${ship.shipClass}</span>
        </div>
        <div class="ship-stats">
            <div class="hp-bar">
                <div class="hp-fill" style="width: ${hpPercent}%; background-color: ${hpPercent > 60 ? '#4CAF50' : hpPercent > 30 ? '#FF9800' : '#F44336'}"></div>
                <span class="hp-text">${ship.hp}/${maxHP} HP</span>
            </div>
            <div class="movement-bars">
                <div class="speed-bar">
                    <div class="speed-fill" style="width: ${speedPercent}%; background-color: ${speedPercent > 60 ? '#2196F3' : '#F44336'}"></div>
                    <span class="speed-text">${ship.currentSpeed}/${ship.maxSpeed} Скорость</span>
                </div>
                <div class="maneuver-bar">
                    <div class="maneuver-fill" style="width: ${maneuverPercent}%; background-color: ${maneuverPercent > 60 ? '#9C27B0' : '#F44336'}"></div>
                    <span class="maneuver-text">${ship.currentManeuverability}/${ship.maxManeuverability} Манёвр</span>
                </div>
            </div>
            ${ship.hasFreeTurn ? '<div class="free-turn-indicator">🔄 Бесплатный поворот доступен</div>' : ''}
            ${isDetailed ? `
                <div class="ship-details">
                    <span>Позиция: (${ship.position.q}, ${ship.position.r})</span>
                    <span>Броня: ${stats.armor}</span>
                    <span>Активация: ${stats.activation}+</span>
                </div>
            ` : ''}
        </div>
    `;

    return card;
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
    
    .dice-slot.selected {
    border-color: #FFD700 !important;
    box-shadow: 0 0 10px #FFD700 !important;
    }

    .battle-ship-card.can-activate {
    border: 2px solid #4CAF50;
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.3);
    }
    
    .ship-icon {
        cursor: pointer;
    }
    
    .ship-icon:hover {
        filter: brightness(1.1);
    }
    
    .free-turn-indicator {
    background: #4CAF50;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    margin-top: 4px;
    font-size: 0.8em;
    text-align: center;
    font-weight: bold;
    }
    `;

    // Создаем и добавляем элемент style
    const styleSheet = document.createElement('style');
    styleSheet.id = 'battle-styles';
    styleSheet.textContent = battleStyles;
    document.head.appendChild(styleSheet);

    console.log('Battle styles added');
}

function displayCombatResults(data) {
    const { results } = data;

    results.forEach(result => {
        if (result.error) {
            logBattle(`${result.weaponId}: ${result.error}`);
            return;
        }

        result.steps.forEach(step => {
            logBattle(step.message);
        });

        if (result.additionalEffects) {
            result.additionalEffects.forEach(effect => {
                logBattle(`⚡ ${effect}`);
            });
        }
    });
}