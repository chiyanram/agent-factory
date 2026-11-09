// probe — the small program the live egress checks run inside a runner (#130; check.ts). The runner image has Node and
// no curl, so it is plain Node, passed as `node -e PROBE <mode> <args>`, with no shell. It prints one JSON line and
// exits 0 whenever it could try; what the line means is check.ts's to read.
//
//   via <proxy host> <proxy port> <host> <port>   CONNECT through the proxy: {"proxy":403}, or on 200 a TLS handshake
//                                                 and a HEAD /: {"proxy":200,"server":"HTTP/1.1 404 Not Found"}
//   direct <ip> <port>                            a TCP connection that skips the proxy: {"connected":true} or {"error"}
//   dns <name>                                    a name lookup: {"address":"…"} or {"error":"ENOTFOUND"}
//   scan <ip> <first port> <last port>            every port that accepts a TCP connection: {"open":[22,3128]}
//
// Every mode gives up after a time limit and prints {"error":"timeout"}, so a dropped packet never hangs the check.

// how long one mode may take, in seconds; a scan of every port takes longer when the host drops instead of refusing
export const PROBE_SECONDS = { connect: 20, scan: 300 } as const;

export const PROBE = String.raw`
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const [mode, ...a] = process.argv.slice(1);
const done = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(0); };
const why = (e) => ({ error: e.code || e.message });
setTimeout(() => done({ error: "timeout" }), (mode === "scan" ? ${PROBE_SECONDS.scan} : ${PROBE_SECONDS.connect}) * 1000);
function via(ph, pp, host, port) {
  const s = net.connect(Number(pp), ph);
  s.on("error", (e) => done(why(e)));
  s.once("connect", () => s.write("CONNECT " + host + ":" + port + " HTTP/1.1\r\nHost: " + host + ":" + port + "\r\n\r\n"));
  let head = "";
  const read = (d) => {
    head += d.toString("latin1");
    if (head.indexOf("\r\n\r\n") < 0) return;
    s.off("data", read);
    const proxy = Number(head.split(" ")[1]);
    if (proxy !== 200) return done({ proxy });
    const t = tls.connect({ socket: s, servername: host });
    t.on("error", (e) => done({ proxy, ...why(e) }));
    t.once("secureConnect", () => t.write("HEAD / HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n"));
    let out = "";
    t.on("data", (d) => { out += d; const i = out.indexOf("\r\n"); if (i >= 0) done({ proxy, server: out.slice(0, i) }); });
  };
  s.on("data", read);
}
function direct(ip, port) {
  const s = net.connect(Number(port), ip);
  s.once("connect", () => done({ connected: true }));
  s.once("error", (e) => done(why(e)));
}
function scan(ip, first, last) {
  const open = [];
  let next = Number(first);
  let live = 0;
  const end = Number(last);
  const one = (port) => {
    let over = false;
    const s = net.connect(port, ip);
    const close = (ok) => {
      if (over) return;
      over = true;
      if (ok) open.push(port);
      s.destroy();
      live -= 1;
      more();
    };
    s.setTimeout(1500, () => close(false));
    s.once("connect", () => close(true));
    s.once("error", () => close(false));
  };
  const more = () => {
    while (live < 256 && next <= end) { live += 1; one(next); next += 1; }
    if (live === 0 && next > end) done({ open: open.sort((x, y) => x - y) });
  };
  more();
}
if (mode === "via") via(a[0], a[1], a[2], a[3]);
else if (mode === "direct") direct(a[0], a[1]);
else if (mode === "dns") dns.lookup(a[0], (e, address) => done(e ? why(e) : { address }));
else if (mode === "scan") scan(a[0], a[1], a[2]);
else done({ error: "unknown mode " + mode });
`;
