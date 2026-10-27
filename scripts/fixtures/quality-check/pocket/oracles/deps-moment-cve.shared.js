'use strict';
// Version helpers for the two moment oracles. Not an oracle itself.

// 2.29.4 fixed CVE-2022-31129 (ReDoS); CVE-2022-24785 (locale path traversal) was
// fixed in 2.29.2.
const FLOOR = [2, 29, 4];

// The lowest version a spec allows: the first x.y.z in it (an exact pin, or the
// lower bound of ^, ~, >= or a hyphen range). null when it names none ("latest").
function lowestOf(spec) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(spec || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeast(v, floor) {
  for (let i = 0; i < 3; i++) if (v[i] !== floor[i]) return v[i] > floor[i];
  return true;
}

module.exports = { FLOOR, lowestOf, atLeast };
