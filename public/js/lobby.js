// public/js/lobby.js

// Инициализирует кнопки лобби
export function initLobbyUI(callbacks) {
    document.getElementById('refreshRoomsBtn').onclick   = callbacks.onRefresh;
    document.getElementById('createRoomBtn').onclick     = callbacks.onCreateRoom;
    document.getElementById('changeNicknameBtn').onclick = callbacks.onChangeNick;
    document.getElementById('chooseFleetBtn').onclick    = callbacks.onChooseFleet;
    document.getElementById('toBattleBtn').onclick       = callbacks.onReady;
}

// Рисует список комнат
export function renderRoomsList(rooms, myNick, callbacks) {
    const ul = document.getElementById('roomsUl');
    ul.innerHTML = '';
    rooms.forEach(r => {
        const li = document.createElement('li');
        li.appendChild(document.createTextNode(r.name + ' ['));
        r.players.forEach((p,i) => {
            const span = document.createElement('span');
            span.textContent = p.nick;
            span.style.color = p.ready ? 'green' : 'red';
            li.appendChild(span);
            if (i < r.players.length - 1) li.appendChild(document.createTextNode(', '));
        });
        li.appendChild(document.createTextNode(']'));

        const mine = r.players.some(p => p.nick === myNick);
        li.onclick = () => {
            if (mine)                 return alert('Вы уже в комнате');
            if (r.players.length >= 2) return alert('Комната полна');
            callbacks.onJoin(r.roomId);
        };

        ul.appendChild(li);
    });
}
