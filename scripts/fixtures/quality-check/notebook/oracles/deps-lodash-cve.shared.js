'use strict';
// Version helpers for the two lodash oracles. Not an oracle itself.

// 4.17.21 fixed CVE-2020-8203 (prototype pollution, first fixed in 4.17.19) and
// the two later advisories, CVE-2021-23337 and CVE-2020-28500.
const FLOOR = [4, 17, 21];

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
