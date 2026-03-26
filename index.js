const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());

const server = http.createServer(app);

// Настройки сокетов
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100 МБ лимит для тяжелых фото и ГС
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
});

const distPath = path.join(__dirname, "dist");

// 1. ПОДКЛЮЧЕНИЕ СТАТИКИ (JS, CSS, Картинки из папки dist)
app.use(express.static(distPath));

// 2. ЛОГИКА МЕССЕНДЖЕРА
let users = {};
let messageQueue = {}; // Очередь для оффлайн сообщений { "username": [messages] }

io.on("connection", (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // Вход пользователя + проверка очереди
  socket.on("user_join", (userData) => {
    if (!userData || !userData.username) return;

    users[socket.id] = { ...userData, socketId: socket.id };
    const myName = userData.username.toLowerCase();

    // Отправляем накопленные оффлайн сообщения
    if (messageQueue[myName] && messageQueue[myName].length > 0) {
      console.log(
        `Отдаю оффлайн сообщения для ${userData.username} (${messageQueue[myName].length} шт.)`,
      );
      messageQueue[myName].forEach((msg) => {
        socket.emit("receive_message", msg);
      });
      delete messageQueue[myName]; // Очищаем после доставки
    }

    console.log(`Юзер ${userData.username} в сети`);
    io.emit("update_users", Object.values(users));
  });

  // Отправка сообщений (с проверкой онлайна)
  socket.on("send_message", (msgData) => {
    if (msgData.to) {
      const toName = msgData.to.toLowerCase();
      const isOnline = Object.values(users).find(
        (u) => u.username && u.username.toLowerCase() === toName,
      );

      if (isOnline) {
        console.log(`Рассылаю сообщение для ${msgData.to} (в сети)`);
        io.emit("receive_message", msgData);
      } else {
        // Сохраняем в очередь, если человек оффлайн
        if (!messageQueue[toName]) messageQueue[toName] = [];
        messageQueue[toName].push(msgData);
        console.log(`Сообщение для ${toName} сохранено в оффлайн-очередь`);
      }
    } else {
      // Если адресат не указан (общий чат), просто рассылаем всем
      console.log("Рассылаю сообщение в общий чат");
      io.emit("receive_message", msgData);
    }
  });

  // Удаление сообщения
  socket.on("delete_message", (msgId) => {
    if (msgId) {
      console.log(`Удаление сообщения: ${msgId}`);
      io.emit("message_deleted", msgId);
    }
  });

  // Редактирование сообщения
  socket.on("edit_message", (data) => {
    if (data && data.id) {
      console.log(`Редактирование сообщения ${data.id}`);
      io.emit("message_edited", data);
    }
  });

  // Статус "Прочитано"
  socket.on("mark_read", (data) => {
    io.emit("status_updated", data);
  });

  // Выход/отключение
  socket.on("disconnect", () => {
    if (users[socket.id]) {
      console.log(`Пользователь ${users[socket.id].username} вышел`);
      delete users[socket.id];
      io.emit("update_users", Object.values(users));
    }
  });
});

// 3. ФИНАЛЬНЫЙ ФИКС ДЛЯ SPA (React/Vite)
// Используем middleware вместо '*' для предотвращения PathError
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res
      .status(404)
      .send("Папка dist или index.html не найдены на сервере. Сделайте build!");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik Messenger запущен на порту ${PORT}`);
});
