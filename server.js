const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "customers.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const clients = new Set();

ensureDataFile();

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/api/customers" && request.method === "GET") {
      return sendJson(response, readCustomers());
    }

    if (request.url === "/api/customers" && request.method === "PUT") {
      const customers = await readJsonBody(request);
      if (!Array.isArray(customers)) {
        return sendJson(response, { error: "Expected an array of customers." }, 400);
      }

      writeCustomers(customers);
      broadcastCustomers();
      return sendJson(response, { ok: true });
    }

    if (request.url === "/api/events" && request.method === "GET") {
      return openEventStream(response);
    }

    return serveStatic(request, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, { error: "Server error." }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Customer tracker running at http://localhost:${PORT}`);
});

function serveStatic(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, `http://localhost:${PORT}`).pathname);
  const filePath = requestedPath === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, requestedPath);
  const safePath = path.normalize(filePath);

  if (!safePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(safePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const contentType = mimeTypes[path.extname(safePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
}

function openEventStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  clients.add(response);
  response.write(`event: customers\ndata: ${JSON.stringify(readCustomers())}\n\n`);

  response.on("close", () => {
    clients.delete(response);
  });
}

function broadcastCustomers() {
  const payload = `event: customers\ndata: ${JSON.stringify(readCustomers())}\n\n`;
  clients.forEach((client) => client.write(payload));
}

function readCustomers() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeCustomers(customers) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(customers, null, 2));
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }

  if (!fs.existsSync(DATA_FILE)) {
    writeCustomers([]);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "null"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
