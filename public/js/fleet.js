// public/js/fleet.js

let fleetsData = [];
let shipProjects = [];
let selectedFleet = null;

/**
 * Инициализирует UI флотов.
 * @param {function(string)} showView — функция переключения view (lobby, fleet, editor, ship)
 * @param {function(object)} onSelectFleet — колбэк при выборе флота
 * @param {string} myNick — ник текущего игрока
 */
export function initFleetModule(showView, onSelectFleet, myNick) {
    // Навигация
    document.getElementById('backFromFleetViewBtn').onclick = () => showView('lobby');
    document.getElementById('createFleetBtn').onclick     = () => openFleetEditor(null, showView, myNick);
    document.getElementById('saveFleetBtn').onclick       = () => {
        saveFleet()
            .then(() => {
                loadFleets();
                showView('fleet');
                alert('Флот сохранён');
            })
            .catch(() => alert('Ошибка при сохранении флота'));
    };

    // Экспортируем выбор и редактирование флота в глобал для карточек
    window.openFleetEditor = (id) => openFleetEditor(id, showView, myNick);
    window.applyFleet      = (id) => {
        selectedFleet = fleetsData.find(f => f.id === id);
        onSelectFleet(selectedFleet);
        showView('lobby');
    };

    loadFleets();
}

// --- Загрузка и отображение списка флотов ---
function loadFleets() {
    fetch('/api/fleets')
        .then(r => r.json())
        .then(data => {
            fleetsData = data;
            renderFleetGrid();
        });
}

function renderFleetGrid() {
    const grid = document.getElementById('fleetGrid');
    grid.innerHTML = '';
    fleetsData.forEach(f => {
        const card = document.createElement('div');
        card.className = 'fleet-card';
        card.innerHTML = `
      <h3>${f.name}</h3>
      <ul class="fleet-composition">
        ${f.composition.map(c => `<li>${c.shipClass} ×${c.count}</li>`).join('')}
      </ul>
      <div class="controls">
        <button class="edit-fleet" data-id="${f.id}">✎</button>
        <button class="apply-fleet" data-id="${f.id}">✔</button>
      </div>`;
        // навешиваем слушатели
        card.querySelector('.edit-fleet')
            .onclick = () => window.openFleetEditor(f.id);
        card.querySelector('.apply-fleet')
            .onclick = () => window.applyFleet(f.id);
        grid.appendChild(card);
    });
}

// --- Открытие редактора флота ---
function openFleetEditor(id, showView, myNick) {
    selectedFleet = id
        ? fleetsData.find(f => f.id === id)
        : { id: null, name: '', faction: 'Федерация', createdBy: myNick, composition: [] };

    // заполняем форму
    document.getElementById('fleetNameInput').value       = selectedFleet.name;
    document.getElementById('factionInput').value         = selectedFleet.faction;
    document.getElementById('createdByLabel').textContent =
        `Создал: ${selectedFleet.createdBy}`;

    // загружаем проекты кораблей и рендерим таблицы
    fetch('/api/ships')
        .then(r => r.json())
        .then(data => {
            shipProjects = data;
            renderFleetEditor();
            showView('editor');
        });
}

// --- Рендеринг редактора флота (состав + проекты) ---
function renderFleetEditor() {
    // обновляем название/фракцию
    document.getElementById('fleetNameInput').value = selectedFleet.name;
    document.getElementById('factionInput').value   = selectedFleet.faction;

    // 1) Состав флота
    const compTbody = document.querySelector('#compositionTable tbody');
    compTbody.innerHTML = '';
    selectedFleet.composition.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.onclick = () => showShipInfoByComp(idx);

        tr.innerHTML = `
      <td>${c.shipClass}</td>
      <td>${getProjectName(c.projectId)}</td>
      <td>${c.count}</td>
      <td><button class="cnt-plus">+</button></td>
      <td><button class="cnt-minus">−</button></td>
      <td><button class="cnt-remove">×</button></td>`;

        tr.querySelector('.cnt-plus').onclick    = e => { e.stopPropagation(); changeCnt(idx, +1); };
        tr.querySelector('.cnt-minus').onclick   = e => { e.stopPropagation(); changeCnt(idx, -1); };
        tr.querySelector('.cnt-remove').onclick  = e => { e.stopPropagation(); removeComp(idx); };

        compTbody.appendChild(tr);
    });

    // 2) Доступные проекты
    const projTbody = document.querySelector('#projectsTable tbody');
    projTbody.innerHTML = '';
    shipProjects.forEach(p => {
        const tr = document.createElement('tr');
        tr.onclick = () => showShipInfo(p.id);

        const tdClass = document.createElement('td'); tdClass.textContent = p.class;
        const tdName  = document.createElement('td'); tdName.textContent  = p.name;

        const tdAdd = document.createElement('td');
        const btnAdd = document.createElement('button');
        btnAdd.textContent = '+';
        btnAdd.onclick = e => { e.stopPropagation(); addToFleet(p.id); };
        tdAdd.appendChild(btnAdd);

        const tdEdit = document.createElement('td');
        const btnEdit = document.createElement('button');
        btnEdit.textContent = '✎';
        // передаём весь объект проекта в редактор корабля
        btnEdit.onclick = e => { e.stopPropagation(); window.openShipConstructor(p); };
        tdEdit.appendChild(btnEdit);

        tr.append(tdClass, tdName, tdAdd, tdEdit);
        projTbody.appendChild(tr);
    });
}

// --- Вспомогательные операции ---

// получает имя проекта по его id
function getProjectName(projectId) {
    const pr = shipProjects.find(x => x.id === projectId);
    return pr ? pr.name : projectId;
}

// изменить количество
window.changeCnt = (i, delta) => {
    selectedFleet.composition[i].count = Math.max(0, selectedFleet.composition[i].count + delta);
    renderFleetEditor();
};

// удалить из состава
window.removeComp = (i) => {
    selectedFleet.composition.splice(i, 1);
    renderFleetEditor();
};

// добавить проект в состав
window.addToFleet = (pid) => {
    const p  = shipProjects.find(x => x.id === pid);
    const ex = selectedFleet.composition.find(x => x.projectId === pid);
    if (ex) ex.count++;
    else selectedFleet.composition.push({
        shipClass: p.class,
        projectId: pid,
        count:     1
    });
    renderFleetEditor();
};

// показать инфо по выбранному проекту
window.showShipInfo = (id) => {
    const p = shipProjects.find(x => x.id === id);
    showInfoPanel(p);
};
window.showShipInfoByComp = (i) => {
    const c = selectedFleet.composition[i];
    const p = shipProjects.find(x => x.id === c.projectId);
    showInfoPanel(p);
};

function showInfoPanel(obj) {
    const panel = document.getElementById('shipInfoPanel');
    panel.innerHTML = `
    <h4>${obj.name}</h4>
    <p>Класс: ${obj.class}</p>
    <p>Скорость: ${obj.speed}, Манёвренность: ${obj.maneuverability},
       Броня: ${obj.armor}, Активация: ${obj.activation}</p>
    <h5>Модули:</h5>
    <ul>${obj.modules.map(m => `<li>${m.name} (${m.effect}, ${m.cost})</li>`).join('')}</ul>`;
}

// сохраняем флот на сервер
function saveFleet() {
    const method = selectedFleet.id ? 'PUT' : 'POST';
    const url    = selectedFleet.id
        ? `/api/fleets/${selectedFleet.id}`
        : '/api/fleets';

    selectedFleet.name    = document.getElementById('fleetNameInput').value.trim();
    selectedFleet.faction = document.getElementById('factionInput').value;

    return fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedFleet)
    })
        .then(r => r.json())
        .then(data => { if (data.id) selectedFleet.id = data.id; });
}

// даём доступ к выбранному флоту
export function getSelectedFleet() {
    return selectedFleet;
}


