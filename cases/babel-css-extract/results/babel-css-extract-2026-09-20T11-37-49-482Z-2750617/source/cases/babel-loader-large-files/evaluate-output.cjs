const assert = require('node:assert/strict');
const output = require(process.argv[2]);
assert.equal(output.value, Number(process.argv[3]));
assert.equal(output.checksum, Number(process.argv[4]));
console.log(JSON.stringify({ value: output.value, checksum: output.checksum }));
