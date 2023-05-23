const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http").Server(app);
const io = require("socket.io")(http);

app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(cookieParser());

// List of available rooms
let topic = [];

io.on("connection", (socket) => {
  // Join a chat room
  socket.on("join-room", (topicId) => {
    console.log("Joined room", topicId);
    socket.join(topicId);
    io.emit("joined-room", topic);
  });

  //switch a room without leaving the previous room
  socket.on("switch-room", (topicId, current) => {
    socket.leave(current);
    socket.join(topicId);
    io.emit("switched-room", topicId);
    console.log("switched-room from ", current, "to ", topicId);
  });

  //send a message in a current room
  socket.on("send-message", (data) => {
    const { topicId } = data;
    socket.to(topicId).emit("recieved-message", data);
    console.log("message sent to ", topicId, "it waas ", data);
  });

  socket.on("disconnect", () => {
    topic = topic.filter((topic) => topic.socketId !== socket.id);
    console.log("Left room", topic);
    io.emit("Left a topic", topic);
  });
});

http.listen(4300, function () {
  console.log("Rooms on 4300");
});
