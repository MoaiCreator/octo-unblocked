// net.js - peer-to-peer multiplayer on top of PeerJS (WebRTC data channels).
// The host runs the whole simulation; clients send inputs and receive snapshots. PeerJS' free public broker
// is only used to pair the browsers (room code -> connection); game traffic then flows peer to peer.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', PREFIX = 'octostrike-';
export const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const netAvailable = () => typeof window.Peer !== 'undefined';
const peerOpts = { debug: 0 };

export class HostNet {
  constructor() { this.peer = null; this.conns = new Map(); this.onJoin = null; this.onLeave = null; this.onMsg = null; this.code = ''; this.nextId = 1; }
  open() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const code = makeCode(), peer = new window.Peer(PREFIX + code, peerOpts);
        let done = false;
        peer.on('open', () => { done = true; this.peer = peer; this.code = code; resolve(code); });
        peer.on('error', (e) => {
          if (!done && e.type === 'unavailable-id' && ++tries < 6) { try { peer.destroy(); } catch (_) {} attempt(); }
          else if (!done) { done = true; reject(new Error(e.type || 'network error')); }
        });
        peer.on('connection', (conn) => {
          const cid = this.nextId++; this.conns.set(cid, conn);
          conn.on('open', () => this.onJoin && this.onJoin(cid));
          conn.on('data', (d) => this.onMsg && this.onMsg(cid, d));
          const gone = () => { if (this.conns.delete(cid)) this.onLeave && this.onLeave(cid); };
          conn.on('close', gone); conn.on('error', gone);
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
      };
      attempt();
    });
  }
  send(cid, obj) { const c = this.conns.get(cid); if (c && c.open) { try { c.send(obj); } catch (_) {} } }
  broadcast(obj) { for (const c of this.conns.values()) if (c.open) { try { c.send(obj); } catch (_) {} } }
  close() { for (const c of this.conns.values()) { try { c.close(); } catch (_) {} } this.conns.clear(); try { this.peer && this.peer.destroy(); } catch (_) {} this.peer = null; }
}

export class ClientNet {
  constructor() { this.peer = null; this.conn = null; this.onMsg = null; this.onClose = null; }
  connect(code, timeoutMs = 12000) {
    code = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(peerOpts); this.peer = peer; let settled = false;
      const fail = (m) => { if (!settled) { settled = true; try { peer.destroy(); } catch (_) {} reject(new Error(m)); } };
      const timer = setTimeout(() => fail('Timed out - check the room code (or the host may be behind a strict firewall)'), timeoutMs);
      peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? 'Room not found - check the code' : (e.type || 'network error')));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }); this.conn = conn;
        conn.on('open', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
        conn.on('data', (d) => this.onMsg && this.onMsg(d));
        conn.on('close', () => { if (settled) this.onClose && this.onClose(); else fail('Connection closed'); });
        conn.on('error', () => { if (settled) this.onClose && this.onClose(); else fail('Connection error'); });
      });
    });
  }
  send(obj) { if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (_) {} } }
  close() { try { this.conn && this.conn.close(); } catch (_) {} try { this.peer && this.peer.destroy(); } catch (_) {} this.conn = null; this.peer = null; }
}
