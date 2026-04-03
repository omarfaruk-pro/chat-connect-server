const express = require("express");
const cors = require("cors");
const { configDotenv } = require("dotenv");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

configDotenv();
const port = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let messagesCollection;
let usersCollection;
async function run() {
    try {
        const db = client.db("chat_app");
        messagesCollection = db.collection("messages");
        usersCollection = db.collection("user");
    } finally { }
}
run().catch(console.dir);

const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const onlineUsers = new Map();
io.on('connection', async (socket) => {

    socket.on('join_room', async (roomId) => {
        socket.join(roomId);
        const history = await messagesCollection.find({ room: roomId }).sort({ _id: 1 }).limit(50).toArray();
        socket.emit('message_history', history);

    })

    socket.on("message-seen", ({ messageId, userId, roomId }) => {
        socket.to(roomId).emit("message-seen", {
            messageId,
            userId
        });
    });

    socket.on('send_message', async (data) => {
        const result = await messagesCollection.insertOne(data);

        const newMessage = {
            ...data,
            _id: result.insertedId
        };

        socket.to(data.room).emit('receive_message', newMessage);
        socket.emit('receive_message', newMessage); // sender-ও পাবে
    });

    socket.on('typing', (data) => {
        socket.to(data.room).emit('user_typing', data.friendName);
    })

    socket.on('leave_room', (roomId) => {
        socket.leave(roomId);
    })

    const userId = socket.handshake.query.userId;

    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }

    onlineUsers.get(userId).add(socket.id);

    if (onlineUsers.get(userId).size === 1) {
        await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { isActive: true } }
        );

        socket.broadcast.emit("user-status", {
            userId,
            isActive: true
        });
    }

    socket.on("disconnect", async () => {

        const userSockets = onlineUsers.get(userId);

        if (userSockets) {
            userSockets.delete(socket.id);

            if (userSockets.size === 0) {

                onlineUsers.delete(userId);

                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { isActive: false } }
                );

                socket.broadcast.emit("user-status", {
                    userId,
                    isActive: false
                });
            }
        }
    });

})

httpServer.listen(port, () => {
    console.log(`Server running on port ${port}`);
})