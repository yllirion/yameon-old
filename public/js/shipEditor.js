// public/js/shipEditor.js

// «Базовые» статы по классу
const classStats = {
    'Фрегат':   { speed: 5, maneuverability: 5, armor: 5, points: 4, activation: 2 },
    'Эсминец':  { speed: 4, maneuverability: 6, armor: 6, points: 8, activation: 3 },
    'Крейсер':  { speed: 3, maneuverability: 7, armor: 7, points: 12, activation: 4 },
    'Линкор':   { speed: 2, maneuverability: 8, armor: 8, points: 16, activation: 5 },
    'Дредноут': { speed: 1, maneuverability: 9, armor: 9, points: 20, activation: 6 }
};

let moduleList = [];
let currentShip = null;
// сюда запишем функцию переключения view из main.js
let shipShowView = null;

/**
 * Инициализация модуля: загружаем модули и вешаем кнопки
 * @param {function(string)} showView — функция переключения view
 */
export async function initShipEditorModule(showView) {
    shipShowView = showView;
    moduleList  = await fetch('/api/modules').then(r => r.json());

    document.getElementById('backFromShipEditorBtn').onclick = () => shipShowView('editor');
    document.getElementById('saveShipBtn').onclick          = () => {
        saveShip()
            .then(() => alert('Проект корабля сохранён'))
            .catch(() => alert('Ошибка при сохранении корабля'));
    };

    // сделаем глобальными для кнопок +/− в таблицах
    window.addModule    = addModule;
    window.removeModule = removeModule;

    // при смене класса корабля пересоздаём статы и перерисовываем
    document.getElementById('shipClassSelect').onchange = e => {
        currentShip.class = e.target.value;
        Object.assign(currentShip, classStats[currentShip.class]);
        currentShip.modules = [];
        renderShipEditor();
    };
}

/**
 * Открывает редактор корабля для переданного проекта и переключает view
 * @param {{id?:string,name:string,class:string}} project — объект проекта из /api/ships
 */
export function openShipConstructor(project) {
    // Собираем объект currentShip со всеми полями
    currentShip = {
        id:      project.id || null,
        name:    project.name,
        class:   project.class,
        modules: [],
        ...classStats[project.class]
    };

    // Заполняем форму
    document.getElementById('shipNameInput').value   = currentShip.name;
    document.getElementById('shipClassSelect').value = currentShip.class;

    renderShipEditor();
    // и переключаемся на View редактора корабля
    shipShowView('shipEditor');
}

/** Отрисовывает форму редактора корабля */
export function renderShipEditor() {
    document.getElementById('statSpeed').textContent      = currentShip.speed;
    document.getElementById('statManeuver').textContent   = currentShip.maneuverability;
    document.getElementById('statArmor').textContent      = currentShip.armor;
    document.getElementById('statActivation').textContent = currentShip.activation;
    const used = currentShip.modules.reduce((sum, m) => sum + m.cost, 0);
    currentShip.pointsLeft = currentShip.points - used;
    document.getElementById('statPoints').textContent = currentShip.pointsLeft;

    // установленные модули
    const ti = document.querySelector('#installedModulesTable tbody');
    ti.innerHTML = currentShip.modules.map((m, i) =>
        `<tr>
       <td>${m.name}</td>
       <td>${m.effect}</td>
       <td>${m.cost}</td>
       <td><button onclick="removeModule(${i});event.stopPropagation()">×</button></td>
     </tr>`
    ).join('');

    // доступные модули
    const ta = document.querySelector('#availableModulesTable tbody');
    ta.innerHTML = moduleList.map(m =>
        `<tr>
       <td>${m.name}</td>
       <td>${m.type}</td>
       <td>${m.cost}</td>
       <td><button onclick="addModule('${m.id}');event.stopPropagation()">+</button></td>
     </tr>`
    ).join('');
}

/** Сохранить корабль на сервер */
export function saveShip() {
    currentShip.name = document.getElementById('shipNameInput').value.trim();
    const method = currentShip.id ? 'PUT' : 'POST';
    const url    = currentShip.id ? `/api/ships/${currentShip.id}` : '/api/ships';

    return fetch(url, {
        method,
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(currentShip)
    })
        .then(r => r.json())
        .then(data => { if (data.id) currentShip.id = data.id; });
}

// добавить модуль (кнопка +)
function addModule(id) {
    const m = moduleList.find(x => x.id === id);
    if (currentShip.pointsLeft >= m.cost) {
        currentShip.modules.push(m);
        renderShipEditor();
    } else {
        alert('Недостаточно очков');
    }
}

// удалить модуль (кнопка ×)
function removeModule(i) {
    currentShip.modules.splice(i, 1);
    renderShipEditor();
}

