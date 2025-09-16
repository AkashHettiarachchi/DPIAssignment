const net = require('net');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 1080;

let config = {
  port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
  user: process.env.USERNAME || process.env.USER || process.env.USERNAME_PROXY,
  pass: process.env.PASS || process.env.PASSWORD || process.env.PASS_PROXY
};

try {
  const cfgPath = path.resolve(process.cwd(), 'index.json');
  if (fs.existsSync(cfgPath)) {
    const fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    config = Object.assign({}, fileCfg, config);
  }
} catch (err) {
  console.error('Warning: error reading index.json', err.message);
}

config.port = config.port || DEFAULT_PORT;
config.user = config.user || 'proxyuser';
config.pass = config.pass || 'proxypass';

console.log(`Starting SOCKS5 proxy on port ${config.port}`);
console.log(`Auth username: "${config.user}" password: "${config.pass}"`);


function readBytesExact(socket, n) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let got = 0;
    function onData(chunk) {
      chunks.push(chunk);
      got += chunk.length;
      if (got >= n) {
        socket.pause();
        const buf = Buffer.concat(chunks, got).slice(0, n);
        const rest = Buffer.concat(chunks, got).slice(n);
        socket.removeListener('data', onData);
        if (rest.length) socket.unshift(rest);
        resolve(buf);
      }
    }
    socket.on('data', onData);
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('socket closed')));
    socket.resume();
  });
}

function readUntil(socket, nPrefix) {
}

const server = net.createServer((clientSock) => {
  clientSock.once('error', (e) => {
  });

  clientSock.on('close', () => { });

  (async () => {
    try {
      clientSock.pause();

      const header = await readBytesExact(clientSock, 2);
      if (header[0] !== 0x05) throw new Error('Only SOCKS5 supported');
      const nmethods = header[1];
      const methodsBuf = await readBytesExact(clientSock, nmethods);
      const methods = Array.from(methodsBuf);

      const METHOD_NO_AUTH = 0x00;
      const METHOD_USERPASS = 0x02;
      const METHOD_NO_ACCEPTABLE = 0xFF;

      let chosenMethod = METHOD_NO_ACCEPTABLE;
      if (methods.includes(METHOD_USERPASS)) chosenMethod = METHOD_USERPASS;
      else if (methods.includes(METHOD_NO_AUTH)) chosenMethod = METHOD_NO_AUTH;
      if (chosenMethod === METHOD_NO_AUTH) {
        chosenMethod = METHOD_USERPASS;
      }

      if (!methods.includes(METHOD_USERPASS)) {
        clientSock.write(Buffer.from([0x05, 0xFF]));
        clientSock.end();
        return;
      }

      clientSock.write(Buffer.from([0x05, METHOD_USERPASS]));

      const verBuf = await readBytesExact(clientSock, 2);
      if (verBuf[0] !== 0x01) throw new Error('Invalid auth version');
      const ulen = verBuf[1];
      const unameBuf = await readBytesExact(clientSock, ulen);
      const plenBuf = await readBytesExact(clientSock, 1);
      const plen = plenBuf[0];
      const passBuf = await readBytesExact(clientSock, plen);
      const uname = unameBuf.toString('utf8');
      const pass = passBuf.toString('utf8');

      let authOk = (uname === config.user && pass === config.pass);
      clientSock.write(Buffer.from([0x01, authOk ? 0x00 : 0x01]));
      if (!authOk) {
        clientSock.end();
        return;
      }

      const reqHeader = await readBytesExact(clientSock, 4);
      if (reqHeader[0] !== 0x05) throw new Error('Invalid SOCKS version in request');
      const cmd = reqHeader[1];
      const atyp = reqHeader[3];

      if (cmd !== 0x01) {
        const REP_COMMAND_NOT_SUPPORTED = 0x07;
        clientSock.write(Buffer.from([0x05, REP_COMMAND_NOT_SUPPORTED, 0x00, 0x01, 0,0,0,0, 0,0]));
        clientSock.end();
        return;
      }

      let destAddr = null;
      if (atyp === 0x01) { 
        const addrBuf = await readBytesExact(clientSock, 4);
        destAddr = Array.from(addrBuf).join('.');
      } else if (atyp === 0x03) { 
        const lenBuf = await readBytesExact(clientSock, 1);
        const len = lenBuf[0];
        const nameBuf = await readBytesExact(clientSock, len);
        destAddr = nameBuf.toString('utf8');
      } else if (atyp === 0x04) { 
        const addrBuf = await readBytesExact(clientSock, 16);
        const parts = [];
        for (let i=0;i<1;i+=2) {
          parts.push(addrBuf.readUInt16BE(i).toString(16));
        }
        destAddr = parts.join(':');
      } else {
        throw new Error('Unsupported ATYP ' + atyp);
      }
      const portBuf = await readBytesExact(clientSock, 2);
      const destPort = portBuf.readUInt16BE(0);

      const clientIP = clientSock.remoteAddress || '<unknown>';
      console.log(new Date().toISOString(), `CONNECT from ${clientIP} -> ${destAddr}:${destPort}`);

      const remote = net.createConnection({ host: destAddr, port: destPort }, () => {
        const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]);
        clientSock.write(reply);

        clientSock.pipe(remote);
        remote.pipe(clientSock);
      });

      remote.on('error', (err) => {
        console.error('Remote connect error:', err.message);
        const REP_HOST_UNREACHABLE = 0x04;
        try {
          clientSock.write(Buffer.from([0x05, REP_HOST_UNREACHABLE, 0x00, 0x01, 0,0,0,0, 0,0]));
        } catch (e) {}
        clientSock.end();
      });

      clientSock.on('close', () => {
        try { remote.end(); } catch (e) {}
      });

      remote.on('close', () => {
        try { clientSock.end(); } catch (e) {}
      });

    } catch (err) {
      console.error('Connection error:', err.message);
      try { clientSock.end(); } catch (e) {}
    }
  })().catch(e => {
    console.error('Unexpected handler error:', e);
    try { clientSock.destroy(); } catch (er) {}
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(config.port, () => {
  console.log(`SOCKS5 server listening on ${config.port}`);
});
