// public/js/main.js
import { initLobbyUI, renderRoomsList } from './lobby.js';
import { initFleetModule, getSelectedFleet } from './fleet.js';
import { initShipEditorModule, openShipConstructor } from './shipEditor.js';
import { drawHexGrid } from './hexmap.js';
import { initBattleUI } from './battleUI.js';

const socket = io();
let myNick = null;
let currentRoomId = null;
let currentBattleRoomId = null;  // ← Добавляем переменную
let selectedFleet = null;

/**
 * Переключает видимые view
 * @param {string} name — префикс id View (lobby, fleet, editor, ship, battle)
 */
function showView(name) {
  document.querySelectorAll('[id$="View"]').forEach(v => v.classList.add('hidden'));
  document.getElementById(name + 'View').classList.remove('hidden');
  if (name === 'fleet') {
    const currentFleetElem = document.getElementById('currentFleet');
    const fleet = getSelectedFleet();
    currentFleetElem.textContent = fleet
        ? `Текущий флот: ${fleet.name}`
        : 'Текущий флот: —';


  }

  if (name === 'editor') loadShipProjects();
}

// Экспортируем функцию для получения текущей комнаты в бою
/*
export function getCurrentRoomId() {
  return currentBattleRoomId;
}
*/
socket.on('connect', () => {
  // Инициализация ника
  myNick = `Player_${socket.id.slice(0,5)}`;
  document.getElementById('currentNickname').textContent = myNick;

  // --- Лобби ---
  initLobbyUI({
    onRefresh: () => {
      socket.emit('getRooms', null, rooms => renderRoomsList(rooms, myNick, { onJoin }));
    },
    onCreateRoom: () => {
      const name = document.getElementById('newRoomName').value.trim();
      if (!name) return alert('Введите имя комнаты');
      socket.emit('createRoom', { roomName: name }, res => {
        currentRoomId = res.roomId;
      });
    },
    onChangeNick: () => {
      const nick = document.getElementById('nicknameInput').value.trim();
      if (!nick) return alert('Введите ник');
      socket.emit('setNickname', nick);
      myNick = nick;
      document.getElementById('currentNickname').textContent = nick;
    },
    onChooseFleet: () => {
      showView('fleet');
    },
    onReady: () => {
      if (!currentRoomId) return alert('Сначала войдите в комнату');
      const fleet = getSelectedFleet();
      if (!fleet) return alert('Сначала выберите флот');

      // Сохраняем roomId для использования в боевом интерфейсе
      currentBattleRoomId = currentRoomId;  // ← Добавляем эту строку

      socket.emit('playerReady', { roomId: currentRoomId, fleet });
    }
  });

  function onJoin(roomId) {
    socket.emit('joinRoom', roomId, res => {
      if (res.success) {
        currentRoomId = roomId;
      } else {
        alert(res.error);
      }
    });
  }

  // Начальное заполнение списка комнат
  socket.emit('getRooms', null, rooms => renderRoomsList(rooms, myNick, { onJoin }));
  socket.on('roomsData', rooms => renderRoomsList(rooms, myNick, { onJoin }));

  // --- Редактор флота ---
  initFleetModule(showView, fleet => {
    document.getElementById('selectedFleetLabel').textContent = `Флот: ${fleet.name}`;
  }, myNick);

  // --- Редактор корабля ---
  initShipEditorModule(showView);
  window.openShipConstructor = openShipConstructor;

  // --- Боевое окно ---
  initBattleUI(showView, socket, socket.id);
});