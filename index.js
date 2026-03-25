const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

const server = http.createServer(app);

// Настройки сокетов с поддержкой больших файлов (музыки)
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100 МБ лимит
  pingTimeout: 60000,
});

// 1. ПОДКЛЮЧАЕМ ДИЗАЙН (папка dist)
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// 2. ЛОГИКА МЕССЕНДЖЕРА (ВОССТАНОВЛЕНА)
let users = {};

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id);

  // Когда пользователь входит
  socket.on("user_join", (userData) => {
    if (!userData) return;
    users[socket.id] = { ...userData, socketId: socket.id };
    console.log(`Пользователь ${userData.username} в сети`);
    io.emit("update_users", Object.values(users));
  });

  // Отправка сообщений
  socket.on("send_message", (msgData) => {
    io.emit("receive_message", msgData);
  });

  // Логика передачи музыки между профилями
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

  // Отключение
  socket.on("disconnect", () => {
    if (users[socket.id]) {
      console.log(`${users[socket.id].username} вышел`);
      delete users[socket.id];
      io.emit("update_users", Object.values(users));
    }
  });
});

// 3. ИСПРАВЛЕННЫЙ РОУТИНГ (Fix для Express 5 / Render)
// Используем (.*) вместо * чтобы не было ошибки "Missing parameter name"
app.get("(.*)", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik запущен на порту ${PORT}`);
});
