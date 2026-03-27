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
  status: { type: String, default: "online" },
  steamUrl: String,
  customStickers: Array,
});
const User = mongoose.model("User", UserSchema);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// 3. ЛОГИКА СОКЕТОВ
let activeUsers = {};

// Оптимизация: берем только базу для списка контактов
const getUsersListWithStatus = async () => {
  // Выбираем только то, что нужно для отображения в сайдбаре
  const allUsers = await User.find({}).select("username avatar status");

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
  console.log("Новое соединение:", socket.id);

  // Вход: Минимум данных при старте
  socket.on("user_join", async (userData) => {
    if (!userData || !userData.username) return;
    const usernameLow = userData.username.toLowerCase();

    activeUsers[socket.id] = {
      username: usernameLow,
      socketId: socket.id,
    };

    await User.findOneAndUpdate(
      { username: userData.username },
      { ...userData, socketId: socket.id },
      { upsert: true, new: true },
    );

    const listWithStatus = await getUsersListWithStatus();
    io.emit("update_users", listWithStatus);
  });

  // --- ЛЕНИВАЯ ЗАГРУЗКА ДАННЫХ ---

  // 1. Запрос текстовых деталей (био, баннер, ссылка)
  socket.on("get_profile_details", async (username) => {
    try {
      const details = await User.findOne({ username }).select(
        "banner bio steamUrl musicName",
      );
      if (details) socket.emit("receive_profile_details", details);
    } catch (err) {
      console.error("Ошибка деталей профиля:", err);
    }
  });

  // 2. Запрос тяжелого аудио-файла (только когда нужно играть музыку)
  socket.on("get_my_music", async (username) => {
    try {
      const user = await User.findOne({ username }).select("musicFile");
      if (user)
        socket.emit("receive_music_file", { username, file: user.musicFile });
    } catch (err) {
      console.error("Ошибка загрузки музыки:", err);
    }
  });

  // Оставляем старый метод для совместимости (если фронт еще не перешел на пошаговый)
  socket.on("get_full_profile", async (username) => {
    try {
      const fullUser = await User.findOne({ username: username });
      if (fullUser) socket.emit("receive_full_profile", fullUser);
    } catch (err) {
      console.error("Ошибка получения профиля:", err);
    }
  });

  // --- ОСТАЛЬНАЯ ЛОГИКА (РЕАКЦИИ, СООБЩЕНИЯ) ---

  socket.on("update_profile", async (updatedData) => {
    try {
      await User.findOneAndUpdate(
        { username: updatedData.username },
        { $set: updatedData },
        { new: true },
      );
      const listWithStatus = await getUsersListWithStatus();
      io.emit("update_users", listWithStatus);
      io.emit("profile_updated", updatedData);
    } catch (err) {
      console.error("Ошибка обновления профиля:", err);
    }
  });

  socket.on("change_status", async (data) => {
    try {
      await User.findOneAndUpdate(
        { username: data.username },
        { status: data.status },
      );
      const listWithStatus = await getUsersListWithStatus();
      io.emit("update_users", listWithStatus);
    } catch (err) {
      console.error("Ошибка статуса:", err);
    }
  });

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

  socket.on("send_message", async (msgData) => {
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.emit("receive_message", msgData);
  });

  socket.on("edit_message", async (data) => {
    try {
      await Message.updateOne({ id: data.id }, { $set: { text: data.text } });
      io.emit("message_edited", data);
    } catch (err) {
      console.error("Ошибка ред.:", err);
    }
  });

  socket.on("delete_message", async (id) => {
    try {
      await Message.deleteOne({ id: id });
      io.emit("message_deleted", id);
    } catch (err) {
      console.error("Ошибка удаления:", err);
    }
  });

  socket.on("get_history", async (data) => {
    const history = await Message.find({
      $or: [
        { from: data.me, to: data.partner },
        { from: data.partner, to: data.me },
      ],
    }).sort({ _id: 1 });
    socket.emit("chat_history", history);
  });

  socket.on("mark_as_read", async (data) => {
    await Message.updateMany(
      { from: data.chatPartner, to: data.reader, read: false },
      { $set: { read: true } },
    );
    io.emit("messages_marked_read", data);
  });

  socket.on("send_sticker", (data) => {
    io.emit("receive_message", { ...data, type: "sticker", id: Date.now() });
  });

  socket.on("disconnect", async () => {
    delete activeUsers[socket.id];
    const listWithStatus = await getUsersListWithStatus();
    io.emit("update_users", listWithStatus);
  });
});

app.use((req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send("Build not found!");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`>>> Skadik на порту ${PORT}`));
