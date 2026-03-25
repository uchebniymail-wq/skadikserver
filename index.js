const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs"); // Для проверки папки

const app = express();
app.use(cors());

const server = http.createServer(app);

// Настройки сокетов
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

// 1. ПРОВЕРКА И ПОДКЛЮЧЕНИЕ ПАПКИ DIST
const distPath = path.join(__dirname, "dist");

if (fs.existsSync(distPath)) {
  console.log(">>> Папка dist найдена, подключаю интерфейс...");
  app.use(express.static(distPath));
} else {
  console.error("!!! ОШИБКА: Папка dist не найдена в корне сервера!");
}

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

// 3. РОУТИНГ ДЛЯ БРАУЗЕРА
// Если это не запрос к файлу в dist, отдаем index.html
app.get("*", (req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res
      .status(404)
      .send(
        "Файл index.html не найден. Убедитесь, что вы сделали npm run build и перенесли папку dist.",
      );
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik успешно запущен на порту ${PORT}`);
});
