'use strict';
// loopback.js - loaded with `node --require` ahead of the fixture's server.js by
// scripts/quality-check.js, so every server the fixture starts listens on
// 127.0.0.1 only (review of a047bb8..8ba798c, R2). The fixture serves a planted
// folder-escape bug, and on every interface it would hand the owner's files to
// anyone on the network for as long as a run lasts.
//
// The host is forced here rather than in base/ or change/server.js because the
// fixture is the measuring stick: its bytes, its hash and the diff the finders
// review stay exactly what the recorded runs measured, and a loopback-only
// listen line in that diff could also change how a finder rates the planted bug.

const net = require('net');

const LOOPBACK = '127.0.0.1';
const listen = net.Server.prototype.listen;

// Covers the listen() forms a server uses: (options[, cb]), (port[, host][, backlog][, cb]).
net.Server.prototype.listen = function listenOnLoopback(...args) {
  if (args[0] !== null && typeof args[0] === 'object') args[0] = { ...args[0], host: LOOPBACK };
  else if (typeof args[1] === 'string') args[1] = LOOPBACK;
  else args.splice(1, 0, LOOPBACK);
  return listen.apply(this, args);
};
