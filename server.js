'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN || false,
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory store for tracked users
const trackedUsers = {};

// REST API: get all active tracked users
app.get('/api/users', (req, res) => {
  res.json(Object.values(trackedUsers));
});

// Socket.io real-time communication
io.on('connection', (socket) => {
  // Send current locations to newly connected client
  socket.emit('initial_locations', Object.values(trackedUsers));

  // User registers with a name to start sharing location
  socket.on('register_user', (data) => {
    const name = (data && typeof data.name === 'string' && data.name.trim())
      ? data.name.trim().substring(0, 50)
      : 'Usuario';

    trackedUsers[socket.id] = {
      id: socket.id,
      name,
      lat: null,
      lng: null,
      lastUpdate: null,
      active: true
    };

    socket.emit('registered', trackedUsers[socket.id]);
    io.emit('user_joined', trackedUsers[socket.id]);
    io.emit('locations_update', Object.values(trackedUsers));
  });

  // User updates their GPS location
  socket.on('update_location', (data) => {
    if (!trackedUsers[socket.id]) return;

    const lat = parseFloat(data && data.lat);
    const lng = parseFloat(data && data.lng);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return;
    }

    trackedUsers[socket.id].lat = lat;
    trackedUsers[socket.id].lng = lng;
    trackedUsers[socket.id].lastUpdate = new Date().toISOString();

    io.emit('location_changed', trackedUsers[socket.id]);
  });

  // User disconnects
  socket.on('disconnect', () => {
    if (trackedUsers[socket.id]) {
      const leftUser = { id: socket.id };
      delete trackedUsers[socket.id];
      io.emit('user_left', leftUser);
    }
  });
});

const PORT = process.env.PORT || 3000;

/* istanbul ignore next */
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ControlTime GPS server running on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, trackedUsers };
