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
  maxHttpBufferSize: 1e8, // 100 МБ лимит
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
});

const distPath = path.join(__dirname, "dist");

// 1. ПОДКЛЮЧЕНИЕ СТАТИКИ
app.use(express.static(distPath));

// 2. ЛОГИКА МЕССЕНДЖЕРА
let users = {};
let messageQueue = {}; // Очередь: { "username": [msg1, msg2] }

io.on("connection", (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // Вход пользователя
  socket.on("user_join", (userData) => {
    if (!userData || !userData.username) return;

    // Сохраняем пользователя
    users[socket.id] = { ...userData, socketId: socket.id };
    const myName = userData.username.toLowerCase();

    // ПРОВЕРКА ОФФЛАЙН-ОЧЕРЕДИ С ЗАДЕРЖКОЙ
    if (messageQueue[myName] && messageQueue[myName].length > 0) {
      console.log(
        `Подготовка к отправке ${messageQueue[myName].length} сообщений для ${userData.username}`,
      );

      // Даем фронтенду 500мс, чтобы прогрузить useEffect и слушатели сокетов
      setTimeout(() => {
        if (messageQueue[myName]) {
          messageQueue[myName].forEach((msg) => {
            socket.emit("receive_message", msg);
          });
          console.log(
            `Оффлайн сообщения для ${userData.username} успешно отправлены`,
          );
          delete messageQueue[myName];
        }
      }, 500);
    }

    console.log(`Юзер ${userData.username} в сети`);
    io.emit("update_users", Object.values(users));
  });

  // --- ЛОГИКА ПЕРЕДАЧИ МУЗЫКИ ---
  socket.on("ask_for_music", (targetName) => {
    const target = Object.values(users).find(
      (u) =>
        u.username && u.username.toLowerCase() === targetName.toLowerCase(),
    );
    if (target) {
      io.to(target.socketId).emit("request_music", socket.id);
    }
  });

  socket.on("send_music_to_user", (data) => {
    if (data.to) {
      const sender = users[socket.id];
      io.to(data.to).emit("receive_music", {
        ...data,
        from: sender ? sender.username : null,
      });
    }
  });
  // --- КОНЕЦ ЛОГИКИ МУЗЫКИ ---

  socket.on("send_message", (msgData) => {
    if (msgData.to) {
      const toName = msgData.to.toLowerCase();
      // Ищем получателя в онлайне
      const targetUser = Object.values(users).find(
        (u) => u.username && u.username.toLowerCase() === toName,
      );

      if (targetUser) {
        // Если онлайн — шлем сразу на конкретный сокет
        io.to(targetUser.socketId).emit("receive_message", msgData);
      } else {
        // Если оффлайн — в очередь
        if (!messageQueue[toName]) messageQueue[toName] = [];
        messageQueue[toName].push(msgData);
        console.log(`Сообщение для ${toName} сохранено в очередь (оффлайн)`);
      }
    } else {
      // Общий чат
      io.emit("receive_message", msgData);
    }
  });

  socket.on("delete_message", (msgId) => {
    if (msgId) io.emit("message_deleted", msgId);
  });

  socket.on("edit_message", (data) => {
    if (data && data.id) io.emit("message_edited", data);
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      console.log(`Пользователь ${users[socket.id].username} вышел`);
      delete users[socket.id];
      io.emit("update_users", Object.values(users));
    }
  });
});

// 3. ФИНАЛЬНЫЙ ФИКС ДЛЯ SPA (React/Vite)
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Папка dist не найдена. Сделайте build!");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik Messenger запущен на порту ${PORT}`);
});
