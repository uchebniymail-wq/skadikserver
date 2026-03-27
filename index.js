const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const server = http.createServer(app);

// 1. ПОДКЛЮЧЕНИЕ К БАЗЕ
const MONGO_URI = process.env.MONGO_URI;
mongoose
  .connect(MONGO_URI)
  .then(() => console.log(">>> MongoDB подключена!"))
  .catch((err) => console.error("Ошибка БД:", err));

// СХЕМЫ
const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  file: String,
  type: String,
  time: String,
  read: { type: Boolean, default: false },
  id: Number,
});
const Message = mongoose.model("Message", MessageSchema);

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  avatar: String,
  musicFile: String,
  musicName: String,
  socketId: String,
});
const User = mongoose.model("User", UserSchema);

// Настройки сокетов
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

const distPath = path.join(__dirname, "dist");

// 2. ПОДКЛЮЧЕНИЕ СТАТИКИ
app.use(express.static(distPath));

// 3. ЛОГИКА СОКЕТОВ
let activeUsers = {};

io.on("connection", (socket) => {
  // Вход пользователя
  socket.on("user_join", async (userData) => {
    if (!userData) return;
    activeUsers[socket.id] = {
      username: userData.username.toLowerCase(),
      socketId: socket.id,
    };

    await User.findOneAndUpdate(
      { username: userData.username },
      { ...userData, socketId: socket.id },
      { upsert: true },
    );

    const allUsers = await User.find({});
    const listWithStatus = allUsers.map((u) => ({
      ...u._doc,
      isOnline: Object.values(activeUsers).some(
        (a) => a.username === u.username.toLowerCase(),
      ),
    }));
    io.emit("update_users", listWithStatus);
  });

  // НОВОЕ: Обновление профиля (аватар, музыка)
  socket.on("update_profile", async (updatedData) => {
    try {
      // 1. Обновляем в базе данных MongoDB
      await User.findOneAndUpdate(
        { username: updatedData.username },
        {
          avatar: updatedData.avatar,
          musicFile: updatedData.musicFile,
          musicName: updatedData.musicName,
        },
        { new: true },
      );

      // 2. Рассылаем всем сигнал: "Этот пользователь обновился!"
      io.emit("profile_updated", updatedData);

      console.log(`Профиль ${updatedData.username} обновлен и разослан всем`);
    } catch (err) {
      console.error("Ошибка при обновлении профиля:", err);
    }
  });

  // Сообщения
  socket.on("send_message", async (msgData) => {
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.emit("receive_message", msgData);
  });

  // История чата
  socket.on("get_history", async (data) => {
    const history = await Message.find({
      $or: [
        { from: data.me, to: data.partner },
        { from: data.partner, to: data.me },
      ],
    }).sort({ _id: 1 });
    socket.emit("chat_history", history);
  });

  // Прочитанные сообщения
  socket.on("mark_as_read", async (data) => {
    await Message.updateMany(
      { from: data.chatPartner, to: data.reader, read: false },
      { $set: { read: true } },
    );
    io.emit("messages_marked_read", data);
  });

  // Запрос музыки
  socket.on("ask_for_music", (targetName) => {
    const target = Object.values(activeUsers).find(
      (u) => u.username === targetName.toLowerCase(),
    );
    if (target) io.to(target.socketId).emit("request_music", socket.id);
  });

  // Передача музыки конкретному юзеру
  socket.on("send_music_to_user", (data) => {
    io.to(data.to).emit("receive_music", data);
  });

  // Отключение
  socket.on("disconnect", () => {
    delete activeUsers[socket.id];
  });
});

// 4. ГАРАНТИРОВАННЫЙ ФИКС ДЛЯ EXPRESS 5
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Сделайте билд! Файл index.html не найден.");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik запущен на порту ${PORT}`);
});
