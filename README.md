# DPIAssignment
Take-Home Assessment - (Intern Developer – Proxy Infrastructure)

# Simple SOCKS5 Proxy Server (Node.js)

A minimal SOCKS5 proxy implementation with username/password authentication (RFC1928 + RFC1929).  

## Features
- Accepts incoming SOCKS5 client connections
- Supports only `CONNECT` command (TCP tunneling)
- Username/password authentication
- Logs source → destination connections
- Configurable via environment variables or `config.json`

## How to Run

### Start the proxy with json
{
  "port": 1080,
  "user": "Akash",
  "pass": "proxypass"
}
### Then open command prompt and enter

node index.js

### Afterward will see,

Starting SOCKS5 proxy on port 1080
Auth username: "Akash" password: "proxypass"
SOCKS5 server listening on 1080

## Testing, Example with curl:

### open command prompt and enter

curl -v --socks5-hostname 127.0.0.1:1080 --proxy-user Akash:proxypass https://ipinfo.io/ip

### Expected output

203.0.113.45

