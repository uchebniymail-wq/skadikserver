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
  id: { type: Number, index: true },
  reactions: { type: Map, of: [String], default: {} },
});
const Message = mongoose.model("Message", MessageSchema);

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  avatar: String,
  banner: String,
  bio: String,
  musicFile: String,
  musicName: String,
  socketId: String,
  status: { type: String, default: "online" }, // online, idle, dnd, invisible
  steamUrl: String,
  customStickers: Array,
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

// ОПТИМИЗИРОВАННАЯ ФУНКЦИЯ: берем только легкие поля для общего списка
const getUsersListWithStatus = async () => {
  const allUsers = await User.find({}, "username avatar status steamUrl bio");
  return allUsers.map((u) => {
    const isActive = Object.values(activeUsers).some(
      (a) => a.username === u.username.toLowerCase(),
    );
    const isActuallyOnline = isActive && u.status !== "invisible";
    return {
      ...u._doc,
      isOnline: isActuallyOnline,
      currentStatus: isActuallyOnline ? u.status : "offline",
    };
  });
};

io.on("connection", (socket) => {
  // Вход пользователя
  socket.on("user_join", async (userData) => {
    if (!userData) return;
    activeUsers[socket.id] = {
      username: userData.username.toLowerCase(),
      socketId: socket.id,
    };

    // Сохраняем полный профиль
    await User.findOneAndUpdate(
      { username: userData.username },
      { ...userData, socketId: socket.id },
      { upsert: true },
    );

    const listWithStatus = await getUsersListWithStatus();
    io.emit("update_users", listWithStatus);
  });

  // НОВОЕ: Запрос полных данных профиля по требованию (для ProfileModal)
  socket.on("get_full_profile", async (username) => {
    try {
      const fullUser = await User.findOne({ username });
      socket.emit("receive_full_profile", fullUser);
    } catch (err) {
      console.error("Ошибка получения профиля:", err);
    }
  });

  // Обновление профиля
  socket.on("update_profile", async (updatedData) => {
    try {
      await User.findOneAndUpdate(
        { username: updatedData.username },
        {
          avatar: updatedData.avatar,
          banner: updatedData.banner,
          bio: updatedData.bio,
          status: updatedData.status,
          musicFile: updatedData.musicFile,
          musicName: updatedData.musicName,
          steamUrl: updatedData.steamUrl,
          customStickers: updatedData.customStickers,
        },
        { new: true },
      );

      const listWithStatus = await getUsersListWithStatus();
      io.emit("update_users", listWithStatus);
      io.emit("profile_updated", updatedData);
    } catch (err) {
      console.error("Ошибка при обновлении профиля:", err);
    }
  });

  // Смена статуса
  socket.on("change_status", async (data) => {
    try {
      await User.findOneAndUpdate(
        { username: data.username },
        { status: data.status },
      );
      const listWithStatus = await getUsersListWithStatus();
      io.emit("update_users", listWithStatus);
    } catch (err) {
      console.error("Ошибка при смене статуса:", err);
    }
  });

  // РЕАКЦИИ
  socket.on("add_reaction", async (data) => {
    try {
      const message = await Message.findOne({ id: data.msgId });
      if (message) {
        const currentReactions = message.reactions || new Map();
        const users = currentReactions.get(data.reaction) || [];

        if (users.includes(data.username)) {
          currentReactions.set(
            data.reaction,
            users.filter((u) => u !== data.username),
          );
        } else {
          users.push(data.username);
          currentReactions.set(data.reaction, users);
        }

        message.reactions = currentReactions;
        await message.save();

        io.emit("reaction_updated", {
          msgId: data.msgId,
          reactions: Object.fromEntries(message.reactions),
        });
      }
    } catch (err) {
      console.error("Ошибка реакций:", err);
    }
  });

  // СООБЩЕНИЯ
  socket.on("send_message", async (msgData) => {
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.emit("receive_message", msgData);
  });

  // РЕДАКТИРОВАНИЕ
  socket.on("edit_message", async (data) => {
    try {
      await Message.updateOne({ id: data.id }, { $set: { text: data.text } });
      io.emit("message_edited", data);
    } catch (err) {
      console.error("Ошибка редактирования:", err);
    }
  });

  // УДАЛЕНИЕ
  socket.on("delete_message", async (id) => {
    try {
      await Message.deleteOne({ id });
      io.emit("message_deleted", id);
    } catch (err) {
      console.error("Ошибка удаления:", err);
    }
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

  // Музыка и стикеры
  socket.on("send_sticker", (data) => {
    io.emit("receive_message", { ...data, type: "sticker", id: Date.now() });
  });

  socket.on("ask_for_music", (targetName) => {
    const target = Object.values(activeUsers).find(
      (u) => u.username === targetName.toLowerCase(),
    );
    if (target) io.to(target.socketId).emit("request_music", socket.id);
  });

  socket.on("send_music_to_user", (data) => {
    io.to(data.to).emit("receive_music", data);
  });

  // Отключение
  socket.on("disconnect", async () => {
    delete activeUsers[socket.id];
    const listWithStatus = await getUsersListWithStatus();
    io.emit("update_users", listWithStatus);
  });
});

// ФИКС ДЛЯ EXPRESS
app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Сделайте билд!");
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`>>> Skadik запущен на порту ${PORT}`);
});
