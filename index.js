const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
});

// 1. Сначала подключаем статические файлы из папки dist
// Убедись, что папка 'dist' лежит прямо рядом с этим index.js
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// 2. Код сокетов (io.on...) оставляем без изменений
io.on("connection", (socket) => {
  // Твой текущий код сокетов здесь
  console.log("Подключился:", socket.id);

  socket.on("user_join", (user) => {
    // ... твоя логика
    io.emit("update_users", []); // Пример
  });
  // и так далее...
});

// 3. САМОЕ ВАЖНОЕ: этот блок должен быть в самом конце!
// Он говорит: если запрос не на файл (не на картинку или скрипт), отдай сайт
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Skadik запущен на порту ${PORT}`);
});
