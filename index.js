const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();

app.use(express.static('public'));

const server = http.createServer(app);

// global state is awesome
let state = {
  queue: [],
  current: 0,
  shouldPlay: false, // do we "want" to play more, can be true even if we run out of queue
  playing: false, // is the player currently playing
};

try {
  state = JSON.parse(fs.readFileSync(`${__dirname}/state.json`).toString());
  console.log('restored state', state);
} catch (e) {
  // whatevs
}

const saveState = () => {
  fs.writeFileSync(`${__dirname}/state.json`, JSON.stringify(state));
};

const wss = new WebSocket.Server({ server });

const send = (ws, msg) =>
  ws.send(JSON.stringify(msg), err => err && console.log('send error', err));

const broadcast = msg => wss.clients.forEach(ws => send(ws, msg));

const playVideo = videoId => {
  if (state.queue.includes(videoId)) {
    broadcast({ cmd: 'playVideo', payload: videoId });

    state.shouldPlay = true; // welp at least now
    state.playing = true;
  } else {
    // wtf
    console.log('videoId', videoId, 'not in queue, skipping playback request');
  }
};

const endOfQueue = () => {
  broadcast({ cmd: 'pause' });
};
const broadcastCurQueue = () => {
  broadcast({ cmd: 'curQueue', payload: state.queue.slice(state.current) });
};

function noop() {}

wss.on('connection', function connection(ws) {
  send(ws, { cmd: 'curQueue', payload: state.queue.slice(state.current) });
  if (state.shouldPlay) {
    send(ws, { cmd: 'playVideo', payload: state.queue[state.current] });
  }

  setInterval(() => {
      if (ws.isAlive === false) return ws.terminate();

      //ws.isAlive = false;
      ws.ping(noop);
  }, 1000);

  ws.on('message', function incoming(message) {
    console.log('received: %s', message);

    let data = {};

    // yolo
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('parse error:', e);
    }

    if (data.cmd === 'queueVideo') {
      // Queue new video

      // Only if payload is legit and id not already in queue
      if (
        typeof data.payload === 'string' &&
        !state.queue.includes(data.payload)
      ) {
        const ytRegex = /https:\/\/www.youtube.com\/watch\?v=(.+)/;
        // And only if string is sane
        if (data.payload.match(ytRegex)) {
          const [url, id] = data.payload.match(ytRegex);
          state.queue.push(id);
        }
      }

      // Resume playback if we should be playing and we're not
      if (state.shouldPlay && !state.playing) {
        playVideo(data.payload);
      }

      console.log('queue now', state.queue);

      broadcastCurQueue();
      saveState();
    } else if (data.cmd === 'dequeueVideo') {
      let isCurrent = false;

      if (
        state.queue[state.current] &&
        state.queue[state.current] === data.payload
      ) {
        isCurrent = true;
      }

      // Remove video by id
      state.queue = state.queue.filter(id => id !== data.payload);

      // Play next song if we should be playing something
      if (isCurrent && state.shouldPlay) {
        if (state.current < state.queue.length) {
          playVideo(state.queue[state.current]);
        } else {
          // end of queue
          endOfQueue();
        }
      }

      broadcastCurQueue();
      saveState();
    } else if (data.cmd === 'play') {
      // Resume playback

      state.shouldPlay = true;
      broadcast({ cmd: 'play' });
      saveState();
    } else if (data.cmd === 'pause') {
      // Pause playback

      state.shouldPlay = false;
      broadcast({ cmd: 'pause' });
      saveState();
    } else if (data.cmd === 'next') {
      // Skip to next

      state.shouldPlay = true;
      state.current = Math.min(state.current + 1, state.queue.length - 1);
      playVideo(state.queue[state.current]);
      broadcastCurQueue();
      saveState();
    } else if (data.cmd === 'prev') {
      // Skip to prev

      state.shouldPlay = true;
      state.current = Math.max(state.current - 1, 0);
      playVideo(state.queue[state.current]);
      broadcastCurQueue();
      saveState();
    } else if (data.cmd === 'refresh') {
      broadcast({ cmd: 'refresh' });
    }
  });

  ws.on('error', err => console.log('ws error:', err));
});

wss.on('error', err => console.log('ws server error:', err));

server.listen(8087, function listening() {
  console.log('Listening on %d', server.address().port);
});
