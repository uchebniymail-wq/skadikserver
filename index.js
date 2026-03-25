const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

const server = http.createServer(app);

// Настройки сокетов
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

// 1. ПОДКЛЮЧАЕМ СТАТИКУ (дизайн)
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// 2. ЛОГИКА МЕССЕНДЖЕРА
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
      console.log(`${users[socket.id].username} вышел`);
      delete users[socket.id];
      io.emit("update_users", Object.values(users));
    }
  });
});

// 3. ФИНАЛЬНЫЙ ФИКС РОУТИНГА (Для Express 5)
// Вместо app.get('*') используем функцию-заглушку, которая сработает на любой запрос
app.use((req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik запущен на порту ${PORT}`);
});
