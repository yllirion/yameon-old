// server.js

const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const path       = require('path');
const fs         = require('fs').promises;

const apiRoutes      = require('./modules/apiRoutes');
const socketHandlers = require('./modules/socketHandlers');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

// CORS & JSON
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  next();
});
app.use(express.json());

// Подключаем REST-маршруты
apiRoutes(app, fs, path);

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Подключаем Socket.IO-обработчики
socketHandlers(io);

// Запуск
const PORT = process.env.PORT || 3000;
const HOST = '26.33.217.228';
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});




