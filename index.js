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
});

// 1. ПУТЬ К ПАПКЕ С ДИЗАЙНОМ
const distPath = path.join(__dirname, "dist");

// 2. ПОДКЛЮЧЕНИЕ СТАТИКИ (файлы стилей, картинок и т.д.)
app.use(express.static(distPath));

// 3. ЛОГИКА МЕССЕНДЖЕРА
let users = {};

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id);

  socket.on("user_join", (userData) => {
    if (!userData) return;
    users[socket.id] = { ...userData, socketId: socket.id };
    console.log(`Пользователь ${userData.username} в сети`);
    io.emit("update_users", Object.values(users));
  });

  socket.on("send_message", (msgData) => {
    io.emit("receive_message", msgData);
  });

  socket.on("ask_for_music", (targetUsername) => {
    const target = Object.values(users).find(
      (u) => u.username === targetUsername,
    );
    if (target) {
      io.to(target.socketId).emit("request_music", socket.id);
    }
  });

  socket.on("send_music_to_user", (data) => {
    io.to(data.to).emit("receive_music", data);
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      const name = users[socket.id].username;
      delete users[socket.id];
      console.log(`${name} вышел`);
      io.emit("update_users", Object.values(users));
    }
  });
});

// 4. ГАРАНТИРОВАННЫЙ ФИКС ДЛЯ EXPRESS 5
// Мы не используем app.get('*'), чтобы избежать ошибок библиотеки path-to-regexp.
// Этот блок сработает как "запасной вариант" для любого запроса к серверу.
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res
      .status(404)
      .send("Ошибка: Папка dist или файл index.html не найдены на сервере.");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik запущен на порту ${PORT}`);
});
