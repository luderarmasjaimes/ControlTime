'use strict';

const request = require('supertest');
const { io: ioc } = require('socket.io-client');
const { app, server, trackedUsers } = require('../server');

let serverAddress;

beforeAll((done) => {
  server.listen(0, () => {
    serverAddress = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

// Helper to create a connected socket.io-client
function createClient() {
  return ioc(serverAddress, { forceNew: true, transports: ['websocket'] });
}

describe('GET /api/users', () => {
  test('returns empty array when no users are tracked', async () => {
    const res = await request(app).get('/api/users');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns JSON content-type', async () => {
    const res = await request(app).get('/api/users');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

describe('Static file serving', () => {
  test('serves index.html at /', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

describe('trackedUsers in-memory store', () => {
  test('starts empty', () => {
    expect(Object.keys(trackedUsers).length).toBe(0);
  });
});

describe('Socket.io – user registration', () => {
  test('server emits registered event with user data', (done) => {
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', { name: 'Ana López' });
    });
    client.on('registered', (user) => {
      expect(user.name).toBe('Ana López');
      expect(user.id).toBe(client.id);
      expect(user.active).toBe(true);
      client.disconnect();
      done();
    });
  });

  test('trims and truncates long names', (done) => {
    const longName = 'A'.repeat(100);
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', { name: longName });
    });
    client.on('registered', (user) => {
      expect(user.name.length).toBeLessThanOrEqual(50);
      client.disconnect();
      done();
    });
  });

  test('uses default name when name is missing', (done) => {
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', {});
    });
    client.on('registered', (user) => {
      expect(user.name).toBe('Usuario');
      client.disconnect();
      done();
    });
  });
});

describe('Socket.io – location updates', () => {
  test('valid coordinates are stored and broadcast', (done) => {
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', { name: 'Carlos' });
    });
    client.on('registered', () => {
      client.emit('update_location', { lat: 4.711, lng: -74.0721 });
    });
    client.on('location_changed', (user) => {
      expect(user.lat).toBeCloseTo(4.711);
      expect(user.lng).toBeCloseTo(-74.0721);
      expect(user.lastUpdate).not.toBeNull();
      client.disconnect();
      done();
    });
  });

  test('invalid coordinates are rejected (no update)', (done) => {
    const client = createClient();
    let locationChangedFired = false;
    client.on('connect', () => {
      client.emit('register_user', { name: 'Invalid' });
    });
    client.on('registered', () => {
      client.emit('update_location', { lat: 999, lng: -74 }); // lat out of range
      setTimeout(() => {
        expect(locationChangedFired).toBe(false);
        client.disconnect();
        done();
      }, 200);
    });
    client.on('location_changed', () => {
      locationChangedFired = true;
    });
  });
});

describe('Socket.io – disconnect cleanup', () => {
  test('user removed from trackedUsers on disconnect', (done) => {
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', { name: 'Temp User' });
    });
    client.on('registered', (user) => {
      expect(trackedUsers[user.id]).toBeDefined();
      client.disconnect();
      setTimeout(() => {
        expect(trackedUsers[user.id]).toBeUndefined();
        done();
      }, 200);
    });
  });
});

describe('GET /api/users after registration', () => {
  test('returns registered user', (done) => {
    const client = createClient();
    client.on('connect', () => {
      client.emit('register_user', { name: 'Visible User' });
    });
    client.on('registered', async () => {
      const res = await request(app).get('/api/users');
      expect(res.body.some(u => u.name === 'Visible User')).toBe(true);
      client.disconnect();
      done();
    });
  });
});
