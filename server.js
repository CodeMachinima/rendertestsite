const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const root = __dirname;
const secure = process.argv.includes('--https');
const port = Number(process.env.PORT) || (secure ? 8443 : 8080);
const certificateDirectory = path.join(root, 'certs');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const serveFile = (request, response) => {
  const requestPath = decodeURIComponent(request.url.split('?')[0]);
  const requestedFile = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const filePath = path.resolve(root, requestedFile);

  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(data);
  });
};

let server;
if (secure) {
  const keyPath = path.join(certificateDirectory, 'localhost-key.pem');
  const certificatePath = path.join(certificateDirectory, 'localhost-cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certificatePath)) {
    console.error('HTTPS certificate files are missing. Run `npm run cert` first.');
    process.exit(1);
  }
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certificatePath) }, serveFile);
} else {
  server = http.createServer(serveFile);
}

server.listen(port, '0.0.0.0', () => {
  const protocol = secure ? 'https' : 'http';
  console.log(`Signal Keyboard is running at ${protocol}://localhost:${port}`);
  if (secure) console.log(`For another computer, use https://<this-computer-lan-ip>:${port}`);
});

const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on('connection', client => {
  console.log('WebSocket client connected');
  client.on('close', () => console.log('WebSocket client disconnected'));
  client.on('error', cause => console.error('WebSocket client error', cause));
  client.on('message', data => {
    console.log('Relaying WebSocket message', data.toString());
    for (const peer of webSocketServer.clients) {
      if (peer !== client && peer.readyState === WebSocket.OPEN) peer.send(data);
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, client => {
    webSocketServer.emit('connection', client, request);
  });
});
