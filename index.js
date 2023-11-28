const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http").Server(app);
const io = require("socket.io")(http);
const serviceKey = require("./grovyo-89dc2-firebase-adminsdk-pwqju-41deeae515.json");
const admin = require("firebase-admin");
const mongoose = require("mongoose");
const User = require("./models/User");
const Topic = require("./models/topic");
const Message = require("./models/message");

require("dotenv").config();

app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(cookieParser());

//connect to DB
const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);
    mongoose.connect(process.env.DATABASE).then(() => {
      console.log("DB is connected");
    });
  } catch (err) {
    console.log(err);
  }
};
connectDB();

// List of available rooms
let topic = [];
let users = [];
const rooms = {};

admin.initializeApp({
  credential: admin.credential.cert(serviceKey),
  databaseURL: "https://grovyo-89dc2.firebaseio.com",
});

io.on("connection", (socket) => {
  //user joines the server
  // socket.on("join-user", (id) => {
  //   if (!users.some((user) => user.id === id)) {
  //     let user = {
  //       id: id,
  //       socketid: socket.id,
  //       status: "online",
  //     };
  //     users.push(user);
  //     console.log(users, "joined users");
  //   } else {
  //     console.log("already joined", users);
  //     send();
  //   }
  console.log(socket?.id);
  socket.on("join-user", (id) => {
    const existingUser = users.find((user) => user.id === id?.id || id);

    if (!existingUser) {
      let newUser = {
        id: id?.id || id,
        socketid: socket.id,
        status: "online",
        timestamp: `${new Date()}`,
      };
      users.push(newUser);
      console.log(users, "joined users");
    } else {
      // User is already in the room, update their socket ID and mark them as "online"
      existingUser.socketid = socket.id;
      existingUser.status = "online";
      console.log(`User ${existingUser.id} reconnected.`);
    }
  });

  //chats checking if user is online or else timestamp
  socket.on("status-check", (id) => {
    const usercheck = users.find((user) => user?.id === id);

    if (usercheck) {
      io.emit("user-check", true);
    } else {
      io.emit("user-check", users?.timestamp);
    }
  });

  //chats
  socket.on("send", (data) => {
    const user = users.find((user) => user.id === data?.reciever);

    try {
      sendchatmsg({ data, user });
    } catch (e) {
      console.log(e);
    }
  });

  //expressions
  socket.on("send-expression", (data) => {
    const user = users.find((user) => user.id === data?.reciever);

    sendNotiExp({ data, user });
  });

  //community
  // Join a chat room

  socket.on("join-room", (data) => {
    const { userId, topicId } = data;
    if (users[userId]) {
      const currentRoom = users[userId];

      if (currentRoom !== topicId) {
        socket.leave(currentRoom);
        socket.join(topicId);
        users[userId] = topicId;
        console.log(
          "User",
          userId,
          "left room",
          currentRoom,
          "and joined room",
          topicId
        );
      } else {
        socket.leave(currentRoom);
        socket.join(topicId);

        console.log("User", userId, "is already in room", topicId);
      }
    } else {
      socket.join(topicId);
      users[userId] = topicId;
      console.log("User", userId, "joined room", topicId);
    }

    io.emit("joined-room", users);
  });

  socket.on("switch-room", (userId, newTopicId) => {
    if (users[userId]) {
      const currentRoom = users[userId];
      if (currentRoom !== newTopicId) {
        socket.leave(currentRoom);
        socket.join(newTopicId);
        users[userId] = newTopicId;
        console.log(
          "User",
          userId,
          "left room",
          currentRoom,
          "and joined room",
          newTopicId
        );
      } else {
        console.log("User", userId, "is already in room", newTopicId);
      }
    } else {
      socket.join(newTopicId);
      users[userId] = newTopicId;
      console.log("User", userId, "joined room", newTopicId);
    }

    io.emit("switched-room", { userId, newTopicId });
  });

  socket.on("send-message", (data) => {
    const { sendtopicId } = data;
    io.to(sendtopicId).emit("recieved-message", data);

    sendNotifcation(data);
    // savemsg(data);
    console.log("message sent to ", sendtopicId, "it waas ", data);
  });

  socket.on("disconnected", () => {
    for (const [room, roomSocket] of Object.entries(socket.rooms)) {
      if (roomSocket === socket.id && users[room]) {
        const userId = room;
        const currentRoom = users[userId];
        socket.leave(currentRoom);
        delete users[userId];
        console.log("User", userId, "left room", currentRoom);
        io.emit("left-room", userId);
        break;
      }
    }
  });

  socket.on("disconnect", () => {
    const userIndex = users.findIndex((user) => user.socketid === socket.id);
    const us = users.find((u) => u.socketid === socket.id);
    console.log(us?.id);
    if (userIndex !== -1) {
      // users.splice(userIndex, 1);
      users[userIndex].status = "offline";
      users[userIndex].timestamp = `${new Date()}`;
      console.log(
        `User ${users[userIndex].id} with ${socket.id} disconnected.`
      );
    }
    console.log(users);
  });
});

http.listen(4300, function () {
  console.log("Rooms on 4300");
});

const markoffline = async ({ uid }) => {
  await Topic.updateOne(
    { _id: "64ecca149c8418279d97fbe2" },
    { $push: { offline: "64a68d4e736586cadb47dcc4" } }
  );
  console.log("ran");
};

//msg and notificaiton send to chats
const sendchatmsg = async ({ data, user }) => {
  try {
    const sender = await User.findById(data?.sender_id);
    const reciever = await User.findById(data?.reciever);
    let isblocked = false;

    if (reciever && sender) {
      const senderblocks =
        sender?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const recblocks =
        reciever?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const isBlockedbysender = senderblocks.some((blockedId) => {
        if (blockedId === reciever?._id?.toString()) {
          isblocked = true;
        }
      });
      const isBlockedbyrec = recblocks.some((blockedId) => {
        if (blockedId === sender?._id?.toString()) {
          isblocked = true;
        }
      });
    }

    if (isblocked === false) {
      console.log(user, data);
      io.to(user?.socketid).emit("data", data);
      SaveChats(data);
      sendNoti(data);
    } else {
      console.log("blocked");
    }
  } catch (e) {
    console.log(e);
  }
};

//send expression notification
//send notification to people chats
const sendNotiExp = async ({ data, user }) => {
  try {
    const sender = await User.findById(data?.sender_id);
    const reciever = await User.findById(data?.reciever);
    let isblocked = false;

    if (reciever && sender) {
      const senderblocks =
        sender?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const recblocks =
        reciever?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const isBlockedbysender = senderblocks.some((blockedId) => {
        if (blockedId === reciever?._id?.toString()) {
          isblocked = true;
        }
      });
      const isBlockedbyrec = recblocks.some((blockedId) => {
        if (blockedId === sender?._id?.toString()) {
          isblocked = true;
        }
      });
    }

    if (isblocked === false) {
      if (user) {
        io.to(user?.socketid).emit("expressions", data);
        const message = {
          notification: {
            title: user?.fullname,
            body: `Reacted ${data?.exp}`,
          },
          data: {
            screen: "Chats",
            sender_fullname: `${user?.fullname}`,
            sender_id: `${user?._id}`,
            text: `Reacted ${data?.exp}`,
            convId: `${data?.convId}`,
            createdAt: `${data?.createdAt}`,
          },
          token: user?.notificationtoken,
        };
        await admin
          .messaging()
          .send(message)
          .then((response) => {
            console.log("Successfully sent message");
          })
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
    } else {
      console.log("blocked");
    }
  } catch (e) {
    console.log(e);
  }
};

//save chat msgs
const SaveChats = async (data) => {
  try {
    const message = new Message({
      text: data?.text,
      sender: data?.sender_id,
      conversationId: data?.convId,
      typ: data?.typ,
      mesId: data?.mesId,
      reply: data?.reply,
      dissapear: data?.dissapear,
      isread: data?.isread,
      sequence: data?.sequence,
      timestamp: data?.timestamp,
    });
    await message.save();
    // await User.updateOne(
    //   { _id: data?.reciever },
    //   { $push: { mesIds: data?.mesId } }
    // );
    // await User.updateOne(
    //   { _id: data?.sender_id },
    //   { $push: { mesIds: data?.mesId } }
    // );
  } catch (e) {
    console.log(e);
  }
};

//community msgs
const savemsg = async (data) => {
  try {
    const message = new Message({
      text: data?.text,
      sender: data?.sender_id,
      topicId: data?.sendtopicId,
      typ: data?.typ,
      mesId: data?.mesId,
      reply: data?.reply,
      dissapear: data?.dissapear,
      comId: data?.comId,
      sequence: data?.sequence,
      timestamp: data?.timestamp,
    });
    await message.save();
    console.log("saved");
  } catch (e) {
    console.log(e, "notsaved");
  }
};

//send notification to people chats
const sendNoti = async (data) => {
  try {
    const user = await User.findById(data?.reciever);
    if (user) {
      const message = {
        notification: {
          title: data?.sender_fullname,
          body: data?.text,
        },
        data: {
          screen: "Chats",
          sender_fullname: `${data?.sender_fullname}`,
          sender_id: `${data?.sender_id}`,
          text: `${data?.text}`,
          convId: `${data?.convId}`,
          createdAt: `${data?.createdAt}`,
          mesId: `${data?.mesId}`,
          typ: `${data?.typ}`,
        },
        token: user?.notificationtoken,
      };
      await admin
        .messaging()
        .send(message)
        .then((response) => {
          console.log("Successfully sent message");
        })
        .catch((error) => {
          console.log("Error sending message:", error);
        });
    }
  } catch (e) {
    console.log(e);
  }
};

//send notification to multiple people in topics only
const sendNotifcation = async (data) => {
  try {
    const topic = await Topic.findById(data?.sendtopicId).populate({
      path: "notifications",
      model: "User",
      select: "notificationtoken",
    });
    // const subscribedTokens = topic?.notificationtoken?.filter(
    //   (token) => token?.subscribed === true
    // );
    // const subscribedTokens = (topic?.notificationtoken || [])
    //   .filter((token) => token.subscribed === true)
    //   .map((token) => token.token);

    const subscribedTokens = topic?.notifications?.map(
      (t) => t.notificationtoken
    );

    const message = {
      notification: {
        title: data?.sender_fullname,
        body: data?.text,
      },
      data: {
        screen: "CommunityChat",
        sender_fullname: `${data?.sender_fullname}`,
        sender_id: `${data?.sender_id}`,
        text: `${data?.text}`,
        topicId: `${data?.topicId}`,
        createdAt: `${data?.timestamp}`,
        mesId: `${data?.mesId}`,
        typ: `${data?.typ}`,
        comId: `${data?.comId}`,
        props: `${data?.props}`,
        sendtopicId: `${data?.sendtopicId}`,
      },
      tokens: subscribedTokens,
    };

    await admin
      .messaging()
      .sendMulticast(message)
      .then((response) => {
        console.log("Successfully sent message");
      })
      .catch((error) => {
        console.log("Error sending message:", error);
      });
  } catch (e) {
    console.log(e);
  }
};

// await axios.post(`${API}/newmessage/64d7cf927f5cb52c36f8b914`, {
//   topicId: ci,
//   sender: id,
//   text: message,
//   typ: 'message',
//   mesId: rid,
//   comId: comId,
//   dissapear: false,
// });
