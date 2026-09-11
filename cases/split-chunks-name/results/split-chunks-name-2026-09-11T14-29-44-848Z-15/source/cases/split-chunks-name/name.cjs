const { appendFileSync } = require('node:fs');
const path = require('node:path');
const { threadId } = require('node:worker_threads');

module.exports = function (module, chunks, cacheGroupKey, options) {
  if (options.auditDir) {
    appendFileSync(path.join(options.auditDir, `${threadId}.jsonl`), JSON.stringify({
      threadId, resource: module.identifier(), cacheGroupKey, chunks: chunks.length,
    }) + '\n');
  }
  return options.name;
};
