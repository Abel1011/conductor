const { randomUUID } = require("node:crypto");

const MAX_EVENTS = 100;
const clients = new Set();
const buffer = [];
const publishListeners = new Set();

function pushToBuffer(event) {
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) {
    buffer.shift();
  }
}

function onPublish(listener) {
  publishListeners.add(listener);
}

function publish(type, payload = {}) {
  const event = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    ...payload
  };

  pushToBuffer(event);
  const message = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    client.write(message);
  }

  for (const listener of publishListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("Event listener failed", error);
    }
  }

  return event;
}

function connect(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  response.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
  clients.add(response);

  request.on("close", () => {
    clients.delete(response);
  });
}

function listEvents() {
  return [...buffer].reverse();
}

module.exports = {
  connect,
  listEvents,
  onPublish,
  publish
};