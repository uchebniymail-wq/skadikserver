const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

// Раздача статики
app.use(express.static(path.join(__dirname, "dist")));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100MB
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
});

let users = {};
let messageQueue = {}; // Очередь для оффлайн сообщений { "username": [messages] }

io.on("connection", (socket) => {
  console.log(`Подключен клиент: ${socket.id}`);

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
      messageQueue[myName] = []; // Очищаем после доставки
    }

    io.emit("update_users", Object.values(users));
  });

  // Отправка сообщений (с проверкой онлайна)
  socket.on("send_message", (msgData) => {
    // Проверяем, есть ли поле 'to' (адресат)
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

        // Опционально: можно отправить подтверждение отправителю,
        // что сообщение сохранено (например, socket.emit("message_queued", msgData.id))
      }
    } else {
      // Если адресат не указан (общий чат), просто рассылаем всем
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

// Роутинг для SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
