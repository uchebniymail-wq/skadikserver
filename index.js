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
  maxHttpBufferSize: 1e8, // 100MB для картинок и голоса
});

app.use(express.static(path.join(__dirname, "dist")));

let users = {};

io.on("connection", (socket) => {
  // Вход
  socket.on("user_join", (userData) => {
    users[socket.id] = { ...userData, socketId: socket.id };
    io.emit("update_users", Object.values(users));
  });

  // Отправка (текст, фото, голос)
  socket.on("send_message", (msg) => {
    io.emit("receive_message", msg);
  });

  // Удаление
  socket.on("delete_message", (msgId) => {
    io.emit("message_deleted", msgId);
  });

  // Редактирование
  socket.on("edit_message", (data) => {
    io.emit("message_edited", data);
  });

  // Статус "Прочитано"
  socket.on("mark_read", (data) => {
    io.emit("status_updated", data);
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("update_users", Object.values(users));
  });
});

app.use((req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
