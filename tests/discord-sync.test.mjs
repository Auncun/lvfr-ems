import assert from 'node:assert/strict';
import { parseDiscordNickname, normalizeDiscordCallsign } from '../functions/_lib/d1-auth.js';

assert.deepEqual(parseDiscordNickname('[R-13] J.Smith'), { callsign: 'R-13', namePart: 'J.Smith' });
assert.deepEqual(parseDiscordNickname('[R-13] J. Smith'), { callsign: 'R-13', namePart: 'J. Smith' });
assert.deepEqual(parseDiscordNickname(' [r-13] J.Smith '), { callsign: 'R-13', namePart: 'J.Smith ' });
assert.equal(parseDiscordNickname('J.Smith [R-13]'), null);
assert.equal(parseDiscordNickname('R-13 J.Smith'), null);
assert.equal(parseDiscordNickname('[] J.Smith'), null);
assert.equal(normalizeDiscordCallsign(' r-13 '), 'R-13');
console.log('Discord callsign parsing tests passed.');
