const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Translate } = require('@google-cloud/translate').v2;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const translate = new Translate();

let users = {};
let rooms = {};

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Enviar historial de mensajes al cliente cuando se conecta a una sala
    ws.on('message', async (message) => {
        let data = null;
        try {
            data = JSON.parse(message);
        } catch (error) {
            console.error('JSON invàlid', error);
            return;
        }

        switch (data.type) {
            case 'joinRoom':
                if (rooms[data.room]) {
                    ws.send(JSON.stringify({ type: 'messageHistory', history: rooms[data.room].messages }));
                }
                break;
            case 'login':
                if (users[data.name]) {
                    sendTo(ws, { type: 'login', success: false });
                } else {
                    users[data.name] = ws;
                    ws.name = data.name;
                    ws.rooms = [];
                    sendTo(ws, { type: 'login', success: true });
                }
                break;
            case 'createRoom':
                if (rooms[data.room]) {
                    sendTo(ws, { type: 'createRoom', success: false });
                } else {
                    rooms[data.room] = { users: [ws], admins: [ws.name], messages: [] };
                    ws.rooms.push(data.room);
                    sendTo(ws, { type: 'createRoom', success: true });
                }
                break;
            case 'message':
                if (ws.rooms.includes(data.room)) {
                    let room = rooms[data.room];
                    let message = { type: 'message', message: data.message, from: ws.name };
                    room.messages.push(message);
                    let translatedMessage = await translateText(data.message, 'es');
                    broadcast(room, { type: 'message', message: translatedMessage, from: ws.name });
                }
                break;
            case 'deleteMessage':
                if (ws.rooms.includes(data.room) && rooms[data.room].admins.includes(ws.name)) {
                    let room = rooms[data.room];
                    room.messages = room.messages.filter(message => message.message !== data.message);
                    broadcast(room, { type: 'deleteMessage', message: data.message });
                }
                break;
            case 'appointAdmin':
                if (ws.rooms.includes(data.room) && rooms[data.room].admins.includes(ws.name)) {
                    let room = rooms[data.room];
                    if (room.users.some(user => user.name === data.newAdmin)) {
                        room.admins.push(data.newAdmin);
                        broadcast(room, { type: 'message', message: `${ws.name} ha nomenat a ${data.newAdmin} com a administrador`, from: 'server' });
                    }
                }
                break;
            case 'leaveRoom':
                if (ws.rooms.includes(data.room)) {
                    let room = rooms[data.room];
                    let index = room.users.indexOf(ws);
                    if (index !== -1) {
                        room.users.splice(index, 1);
                        ws.rooms.splice(ws.rooms.indexOf(data.room), 1);
                        broadcast(room, { type: 'message', message: `${ws.name} ha abandonat la sala`, from: 'server' });
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        if (ws.name) {
            delete users[ws.name];
            ws.rooms.forEach(roomName => {
                let room = rooms[roomName];
                let index = room.users.indexOf(ws);
                if (index !== -1) {
                    room.users.splice(index, 1);
                    broadcast(room, { type: 'message', message: `${ws.name} ha abandonat la sala`, from: 'server' });
                }
            });
        }
    });
});

async function translateText(text, targetLang) {
    let [translation] = await translate.translate(text, targetLang);
    return translation;
}

function sendTo(conn, message) {
    conn.send(JSON.stringify(message));
}

function broadcast(room, message) {
    room.users.forEach(user => sendTo(user, message));
}

server.listen(8080, () => {
    console.log('El servidor està escoltant al port 8080');
});

app.get('/', (req, res) => {
    res.send('¡Bienvenido a mi servidor de chat!');
});
