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

// --- 1. ПОДКЛЮЧЕНИЕ К БАЗЕ (MongoDB) ---
const MONGO_URI = process.env.MONGO_URI;
mongoose
  .connect(MONGO_URI)
  .then(() => console.log(">>> MongoDB подключена успешно!"))
  .catch((err) => console.error("Ошибка подключения к БД:", err));

// --- 2. СХЕМЫ ДАННЫХ ---
const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  file: String,
  type: String,
  time: String,
  read: { type: Boolean, default: false },
  edited: { type: Boolean, default: false },
  id: Number,
});
const Message = mongoose.model("Message", MessageSchema);

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  avatar: String,
  musicFile: String,
  musicName: String,
  socketId: String,
  lastSeen: { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

// --- 3. НАСТРОЙКИ SOCKET.IO ---
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100 МБ
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
});

const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// Временные объекты для текущей сессии
let activeUsers = {}; // Храним { socketId: { username, ... } }
let messageQueue = {};

// Вспомогательная функция для рассылки актуального списка пользователей с их статусом
const broadcastUsersUpdate = async () => {
  const allRegistered = await User.find({});

  // Мапим список из БД, добавляя флаг isOnline на основе оперативной памяти activeUsers
  const updatedList = allRegistered.map((u) => {
    const isOnline = Object.values(activeUsers).some(
      (active) => active.username.toLowerCase() === u.username.toLowerCase(),
    );
    return { ...u._doc, isOnline };
  });

  io.emit("update_users", updatedList);
};

io.on("connection", (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // Вход пользователя
  socket.on("user_join", async (userData) => {
    if (!userData || !userData.username) return;

    // Обновляем данные пользователя в БД
    const updatedUser = await User.findOneAndUpdate(
      { username: userData.username },
      { ...userData, socketId: socket.id, lastSeen: Date.now() },
      { upsert: true, new: true },
    );

    // Сохраняем в оперативную память активный сокет
    activeUsers[socket.id] = {
      username: userData.username.toLowerCase(),
      socketId: socket.id,
    };

    const myName = userData.username.toLowerCase();

    // Проверка оффлайн-очереди
    if (messageQueue[myName] && messageQueue[myName].length > 0) {
      setTimeout(() => {
        if (messageQueue[myName]) {
          messageQueue[myName].forEach((msg) => {
            socket.emit("receive_message", msg);
          });
          delete messageQueue[myName];
        }
      }, 500);
    }

    // Рассылаем всем обновленный список с учетом статуса Online
    await broadcastUsersUpdate();
    console.log(`Юзер ${userData.username} вошел в сеть`);
  });

  // Запрос истории сообщений
  socket.on("get_history", async (data) => {
    const history = await Message.find({
      $or: [
        { from: data.me, to: data.partner },
        { from: data.partner, to: data.me },
      ],
    }).sort({ id: 1 });
    socket.emit("chat_history", history);
  });

  // Статус прочтения
  socket.on("mark_as_read", async (data) => {
    await Message.updateMany(
      { from: data.chatPartner, to: data.reader, read: false },
      { $set: { read: true } },
    );
    io.emit("messages_marked_read", data);
  });

  // Логика "Печатает..."
  socket.on("typing", (data) => io.emit("user_typing", data));
  socket.on("stop_typing", (data) => io.emit("user_stop_typing", data));

  // Передача музыки
  socket.on("ask_for_music", async (targetName) => {
    const target = await User.findOne({
      username: new RegExp(`^${targetName}$`, "i"),
    });
    if (target && target.socketId) {
      io.to(target.socketId).emit("request_music", socket.id);
    }
  });

  socket.on("send_music_to_user", (data) => {
    if (data.to) {
      const sender = activeUsers[socket.id];
      io.to(data.to).emit("receive_music", {
        ...data,
        from: sender ? sender.username : null,
      });
    }
  });

  // Отправка сообщения
  socket.on("send_message", async (msgData) => {
    const newMessage = new Message(msgData);
    await newMessage.save();

    if (msgData.to) {
      const toName = msgData.to.toLowerCase();
      // Ищем получателя по имени в активных сессиях
      const targetSocketId = Object.keys(activeUsers).find(
        (sid) => activeUsers[sid].username === toName,
      );

      if (targetSocketId) {
        io.to(targetSocketId).emit("receive_message", msgData);
      } else {
        if (!messageQueue[toName]) messageQueue[toName] = [];
        messageQueue[toName].push(msgData);
      }
    } else {
      io.emit("receive_message", msgData);
    }
  });

  // Удаление сообщения
  socket.on("delete_message", async (msgId) => {
    if (msgId) {
      await Message.deleteOne({ id: msgId });
      io.emit("message_deleted", msgId);
    }
  });

  // Редактирование сообщения
  socket.on("edit_message", async (data) => {
    if (data && data.id) {
      await Message.updateOne(
        { id: data.id },
        { text: data.text, edited: true },
      );
      io.emit("message_edited", data);
    }
  });

  // Обработка отключения
  socket.on("disconnect", async () => {
    if (activeUsers[socket.id]) {
      const username = activeUsers[socket.id].username;
      console.log(`Пользователь ${username} покинул сеть`);

      io.emit("user_stop_typing", { from: username });

      // Удаляем из оперативной памяти
      delete activeUsers[socket.id];

      // Рассылаем всем обновленный список, где этот юзер теперь оффлайн
      await broadcastUsersUpdate();
    }
  });
});

// Фикс для SPA
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Папка dist не найдена.");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik Server live on ${PORT}`);
});
