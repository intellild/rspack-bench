const { MessagePort, threadId } = require('node:worker_threads');
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const original = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function(message, ...args) {
  if (message && /^(loader-options-|loader-additional-data-|function-)/.test(message.type || '')) {
    appendFileSync(path.join(__dirname, 'audit', `${threadId}.jsonl`), JSON.stringify({threadId, type:message.type, optionsHandle:message.optionsHandle, functionId:message.functionId, action:message.action}) + '\n');
  }
  return original.call(this, message, ...args);
};
