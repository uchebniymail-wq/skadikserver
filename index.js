const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// Полностью разрешаем CORS для всех HTTP запросов
app.use(cors());

const server = http.createServer(app);

// Блок создания io с твоими настройками (CORS + Buffer 100MB)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Увеличиваем максимальный размер сообщения до 100 МБ
  maxHttpBufferSize: 1e8,
  transports: ["websocket", "polling"],
});

let users = {};

io.on("connection", (socket) => {
  console.log("Подключился сокет:", socket.id);

  socket.on("user_join", (userData) => {
    if (!userData) return;
    // Сохраняем пользователя в объекте по его socket.id
    users[socket.id] = { ...userData, socketId: socket.id };
    console.log(`Пользователь ${userData.username} вошел в сеть`);

    // Рассылаем всем обновленный список активных пользователей
    io.emit("update_users", Object.values(users));
  });

  socket.on("send_message", (msgData) => {
    // Рассылаем сообщение всем (клиент сам отфильтрует нужное по ID)
    io.emit("receive_message", msgData);
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      console.log(`${users[socket.id].username} ушел`);
      delete users[socket.id];
      // Обновляем список у всех после выхода пользователя
      io.emit("update_users", Object.values(users));
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`>>> СЕРВЕР SKADI ЗАПУЩЕН НА ПОРТУ ${PORT}`);
});
