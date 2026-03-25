const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// Полностью разрешаем CORS для всех HTTP запросов
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Увеличиваем лимит до 100 МБ (1e8 байт)
  maxHttpBufferSize: 1e8,
  // Разрешаем долгие соединения, так как музыка весит много и грузится долго
  pingTimeout: 60000,
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

app.get("/", (req, res) => {
  res.send("Сервер мессенджера Skadi запущен и готов к работе!");
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`>>> СЕРВЕР SKADI ЗАПУЩЕН НА ПОРТУ ${PORT}`);
});
