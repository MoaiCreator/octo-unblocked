// server.cpp - authoritative server: rounds, economy, bomb, weapons, lag-compensated hit detection
#include "server.hpp"
#include "shared.hpp"
#include "net.hpp"
#include <atomic>
#include <thread>
#include <chrono>
#include <deque>

namespace cs {

static std::atomic<bool> g_run{false};
static std::atomic<int>  g_status{0};   // 0 starting, 1 ok, -1 failed
static std::thread       g_thr;

static double nowS() { using namespace std::chrono; return duration<double>(steady_clock::now().time_since_epoch()).count(); }
static float frand() { return (float)rand() / (float)RAND_MAX - 0.5f; }

constexpr float FREEZE_T = 10.f, LIVE_T = 115.f, END_T = 5.f, MATCHEND_T = 8.f, PLANT_T = 3.2f, BOMB_T = 40.f;
constexpr int   WIN_ROUNDS = 7;     // first to 7, sides swap after round 6

struct Client {
    bool used = false; net::Addr addr;
    double last = 0, respawnAt = 0, nextShot = 0, reloadEnd = 0;
    PlayerNet n{}; uint8_t buttons = 0;
    uint8_t cur = W_KNIFE, pri = 0, sec = 0;
    bool hasKit = false, helmet = false, hasBomb = false, reloading = false;
    int armor = 0, money = 800; int mag[W_COUNT] = {0}, res[W_COUNT] = {0};
    float prog = 0; V3 anchor{0, 0, 0};
};

struct Server {
    net::Socket sock; std::string name;
    Client cl[MAXP];
    double t = 0, lastT = 0, nextSend = 0;
    int phase = PH_WARMUP; double phaseEnd = 0; int round = 0, score[2] = {0, 0}, lossStreak[2] = {0, 0}, winner = 255, reason = 0;
    int bombState = BS_NONE, carrier = -1; V3 bombPos{0, 0, 0}; double explodeAt = 0;
    KillEv kills[4]{}; uint8_t killSeq = 0;
    struct Snap { double t; V3 p[MAXP]; bool alive[MAXP]; };
    std::deque<Snap> hist;

    // ---------------- helpers ----------------
    int teamCount(int tm) { int n = 0; for (auto& c : cl) if (c.used && c.n.team == tm) n++; return n; }
    void addMoney(Client& c, int v) { c.money = std::max(0, std::min(16000, c.money + v)); }
    void give(Client& c, int id) {
        const WeaponDef& d = wdef(id); c.mag[id] = d.mag; c.res[id] = d.reserve;
        if (d.slot == 1) c.pri = id; else if (d.slot == 2) c.sec = id;
    }
    void resetLoadout(Client& c) {
        c.pri = 0; c.sec = 0; c.armor = 0; c.helmet = c.hasKit = false; c.reloading = false;
        memset(c.mag, 0, sizeof c.mag); memset(c.res, 0, sizeof c.res);
        give(c, c.n.team ? W_USP : W_GLOCK); c.cur = c.sec;
    }
    void spawnPlayer(Client& c, int idx) {
        auto& sp = gmap().spawns[c.n.team]; float x = 0, z = c.n.team ? -30.f : 30.f, yaw = c.n.team ? PIF : 0.f;
        if (!sp.empty()) { const Spawn& s = sp[idx % sp.size()]; x = s.x; z = s.z; yaw = s.yaw; if (idx >= (int)sp.size()) x += 0.9f * (idx / sp.size()); }
        c.n.x = x; c.n.y = 0; c.n.z = z; c.n.yaw = yaw; c.n.pitch = 0; c.n.hp = 100; c.n.alive = 1; c.n.spawnSeq++;
        c.prog = 0; c.buttons = 0; c.reloading = false; c.hasBomb = false; c.cur = c.pri ? c.pri : c.sec; c.nextShot = t + 0.3;
    }
    void pushKill(int killer, int victim, int weapon, bool head) {
        for (int i = 3; i > 0; i--) kills[i] = kills[i - 1];
        kills[0] = {(uint8_t)++killSeq, (uint8_t)(killer < 0 ? 255 : killer), (uint8_t)victim, (uint8_t)weapon, (uint8_t)head};
    }
    void killPlayer(int vi, int ki, int weapon, bool head) {
        Client& v = cl[vi]; v.n.hp = 0; v.n.alive = 0; v.n.deaths++; v.respawnAt = t + 3; v.reloading = false; v.prog = 0;
        if (v.hasBomb) { v.hasBomb = false; bombState = BS_DROPPED; carrier = -1; bombPos = {v.n.x, v.n.y, v.n.z}; }
        if (ki >= 0 && ki != vi) { cl[ki].n.kills++; addMoney(cl[ki], wdef(weapon).reward); }
        pushKill(ki, vi, weapon, head);
        printf("[server] %s killed %s (%s%s)\n", ki >= 0 ? cl[ki].n.name : "BOMB", v.n.name, wdef(weapon).name, head ? ", HS" : "");
    }
    void dropClient(int i) {
        Client& c = cl[i];
        if (c.hasBomb) { bombState = BS_DROPPED; carrier = -1; bombPos = {c.n.x, c.n.y, c.n.z}; }
        printf("[server] %s left\n", c.n.name); c = Client();
    }

    // ---------------- match flow ----------------
    void startRound() {
        round++; winner = 255; bombState = BS_NONE; carrier = -1;
        int iT = 0, iC = 0; std::vector<int> ts;
        for (int i = 0; i < MAXP; i++) {
            Client& c = cl[i]; if (!c.used) continue;
            if (!c.n.alive) resetLoadout(c);               // dead players lose their gear
            spawnPlayer(c, c.n.team ? iC++ : iT++);
            if (c.n.team == 0) ts.push_back(i);
        }
        if (!ts.empty()) { int ci = ts[rand() % ts.size()]; cl[ci].hasBomb = true; carrier = ci; bombState = BS_CARRIED; }
        phase = PH_FREEZE; phaseEnd = t + FREEZE_T;
        printf("[server] round %d  T %d - %d CT\n", round, score[0], score[1]);
    }
    void resetMatch() {
        score[0] = score[1] = 0; lossStreak[0] = lossStreak[1] = 0; round = 0;
        for (auto& c : cl) if (c.used) { c.money = 800; c.n.kills = c.n.deaths = 0; c.n.alive = 0; }
        startRound();
    }
    void enterWarmup() {
        phase = PH_WARMUP; bombState = BS_NONE; carrier = -1; score[0] = score[1] = 0; round = 0;
        for (auto& c : cl) if (c.used) { c.hasBomb = false; c.money = 16000; if (!c.n.alive) c.respawnAt = t + 2; }
        printf("[server] warmup (waiting for both teams)\n");
    }
    void halftime() {
        printf("[server] halftime - swapping sides\n");
        std::swap(score[0], score[1]); lossStreak[0] = lossStreak[1] = 0;
        for (auto& c : cl) if (c.used) { c.n.team ^= 1; c.money = 800; c.n.alive = 0; }
    }
    void endRound(int w, int why) {
        if (phase != PH_LIVE) return;
        winner = w; reason = why; score[w]++;
        int l = w ^ 1;
        lossStreak[l] = std::min(lossStreak[l] + 1, 5); lossStreak[w] = std::max(0, lossStreak[w] - 1);
        int lossBonus = std::min(3400, 1400 + 500 * (lossStreak[l] - 1));
        for (auto& c : cl) if (c.used) {
            if (c.n.team == w) addMoney(c, 3250);
            else { addMoney(c, lossBonus); if (l == 0 && bombState == BS_PLANTED) addMoney(c, 800); }
        }
        printf("[server] %s win the round\n", w ? "CT" : "T");
        if (score[w] >= WIN_ROUNDS) { phase = PH_MATCHEND; phaseEnd = t + MATCHEND_T; }
        else { phase = PH_ROUNDEND; phaseEnd = t + END_T; }
    }
    void checkEnd() {
        int aT = 0, aC = 0; for (auto& c : cl) if (c.used && c.n.alive) (c.n.team ? aC : aT)++;
        if (aC == 0) endRound(0, RS_ELIM);
        else if (aT == 0 && bombState != BS_PLANTED) endRound(1, RS_ELIM);
        else if (t >= phaseEnd && bombState != BS_PLANTED) endRound(1, RS_TIME);
    }

    // ---------------- bomb ----------------
    void bombTick(double dt) {
        if (bombState == BS_DROPPED) for (int i = 0; i < MAXP; i++) {
            Client& c = cl[i];
            if (c.used && c.n.alive && c.n.team == 0 && fabsf(c.n.x - bombPos.x) < 1.1f && fabsf(c.n.z - bombPos.z) < 1.1f && fabsf(c.n.y - bombPos.y) < 1.5f) {
                c.hasBomb = true; carrier = i; bombState = BS_CARRIED; break;
            }
        }
        for (int i = 0; i < MAXP; i++) {
            Client& c = cl[i]; bool did = false;
            if (c.used && c.n.alive && (c.buttons & 1)) {
                bool plant = c.hasBomb && bombState == BS_CARRIED && inSite(gmap(), c.n.x, c.n.z);
                bool defuse = c.n.team == 1 && bombState == BS_PLANTED && fabsf(c.n.x - bombPos.x) < 1.8f && fabsf(c.n.z - bombPos.z) < 1.8f && fabsf(c.n.y - bombPos.y) < 1.5f;
                if (plant || defuse) {
                    if (c.prog <= 0) c.anchor = {c.n.x, c.n.y, c.n.z};
                    float dx = c.n.x - c.anchor.x, dz = c.n.z - c.anchor.z;
                    if (dx*dx + dz*dz > 0.16f) { c.prog = 0; c.anchor = {c.n.x, c.n.y, c.n.z}; }
                    c.prog += (float)dt; did = true;
                    if (plant && c.prog >= PLANT_T) {
                        bombState = BS_PLANTED; bombPos = {c.n.x, c.n.y, c.n.z}; explodeAt = t + BOMB_T;
                        c.hasBomb = false; carrier = -1; c.prog = 0; addMoney(c, 300);
                        if (c.cur == W_C4) c.cur = c.pri ? c.pri : c.sec;
                        printf("[server] bomb planted by %s\n", c.n.name);
                    } else if (defuse && c.prog >= (c.hasKit ? 5.f : 10.f)) {
                        bombState = BS_DEFUSED; addMoney(c, 300); c.prog = 0;
                        printf("[server] bomb defused by %s\n", c.n.name);
                        endRound(1, RS_DEFUSE); return;
                    }
                }
            }
            if (!did) c.prog = 0;
        }
        if (bombState == BS_PLANTED && t >= explodeAt) {
            bombState = BS_EXPLODED;
            for (int i = 0; i < MAXP; i++) {
                Client& c = cl[i]; if (!c.used || !c.n.alive) continue;
                float d = sqrtf((c.n.x-bombPos.x)*(c.n.x-bombPos.x) + (c.n.z-bombPos.z)*(c.n.z-bombPos.z));
                if (d < 16.f) { c.n.hp -= (int)(400 * (1.f - d / 16.f)); if (c.n.hp <= 0) killPlayer(i, -1, W_C4, false); }
            }
            endRound(0, RS_BOMB);
        }
    }

    // ---------------- lag compensation ----------------
    bool rewound(int j, double vt, V3& out) {
        Client& v = cl[j];
        if (hist.empty()) { out = {v.n.x, v.n.y, v.n.z}; return v.n.alive; }
        vt = std::min(std::max(vt, t - 0.3), hist.back().t);
        size_t k = 0; while (k < hist.size() && hist[k].t < vt) k++;
        const Snap& b = k < hist.size() ? hist[k] : hist.back();
        const Snap& a = k > 0 && k < hist.size() ? hist[k - 1] : b;
        double span = b.t - a.t; float al = span > 1e-6 ? (float)((vt - a.t) / span) : 0.f;
        V3 pa = a.p[j], pb = b.p[j];
        float d2 = (pa.x-pb.x)*(pa.x-pb.x) + (pa.z-pb.z)*(pa.z-pb.z);
        if (d2 > 36.f) al = al > 0.5f ? 1.f : 0.f;          // teleport (respawn)
        out = {pa.x + (pb.x-pa.x)*al, pa.y + (pb.y-pa.y)*al, pa.z + (pb.z-pa.z)*al};
        return v.n.alive && b.alive[j];
    }

    // ---------------- combat ----------------
    void startReload(Client& c) {
        const WeaponDef& d = wdef(c.cur);
        if (c.reloading || d.mag == 0 || c.mag[c.cur] >= d.mag || c.res[c.cur] <= 0) return;
        c.reloading = true; c.reloadEnd = t + d.reload;
    }
    void damage(int ai, int vi, int weapon, float dmg, bool head) {
        Client& v = cl[vi]; const WeaponDef& w = wdef(weapon);
        int hpLoss;
        if (v.armor > 0 && (!head || v.helmet)) {
            float red = dmg * w.pen, aLoss = (dmg - red) * 0.5f;
            if (aLoss > v.armor) { aLoss = (float)v.armor; red = dmg - aLoss * 2.f; }
            v.armor -= (int)lroundf(aLoss); hpLoss = (int)lroundf(red);
        } else hpLoss = (int)lroundf(dmg);
        hpLoss = std::max(1, hpLoss);
        cl[ai].n.hits++; v.n.hp -= hpLoss;
        if (v.n.hp <= 0) killPlayer(vi, ai, weapon, head);
    }
    void shoot(int id, V3 d, double viewTime) {
        Client& c = cl[id]; const WeaponDef& w = wdef(c.cur);
        if (!c.n.alive || c.reloading || t < c.nextShot - 0.02) return;
        if (phase == PH_FREEZE || phase == PH_MATCHEND) return;
        if (w.slot == 4 || w.slot == 0) return;
        bool knife = w.slot == 3;
        if (!knife) { if (c.mag[c.cur] <= 0) { startReload(c); return; } c.mag[c.cur]--; }
        c.nextShot = t + w.interval; c.n.shots++;
        V3 o{c.n.x, c.n.y + EYE, c.n.z};
        for (int p = 0; p < w.pellets; p++) {
            V3 dir = d;
            if (w.pellets > 1) { dir.x += frand() * 2 * w.spread; dir.y += frand() * 2 * w.spread; dir.z += frand() * 2 * w.spread;
                float l = sqrtf(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z); dir.x /= l; dir.y /= l; dir.z /= l; }
            float bt = rayWorld(o, dir, knife ? 2.4f : 200.f); int best = -1; V3 bpos{0,0,0};
            for (int j = 0; j < MAXP; j++) {
                Client& v = cl[j];
                if (j == id || !v.used || !v.n.alive || v.n.team == c.n.team) continue;
                V3 pos; if (!rewound(j, viewTime, pos)) continue;           // <-- lag compensation
                V3 mn{pos.x - PR, pos.y, pos.z - PR}, mx{pos.x + PR, pos.y + PH, pos.z + PR}; float tt;
                if (rayBox(o, dir, mn, mx, tt) && tt < bt) { bt = tt; best = j; bpos = pos; }
            }
            if (best < 0 || !cl[best].n.alive) continue;
            float hy = o.y + dir.y * bt - bpos.y; bool head = !knife && hy > 1.45f;
            float dmg = w.dmg * (knife ? 1.f : powf(w.rangeMod, bt / 9.5f));
            if (head) dmg *= w.head; else if (hy < 0.55f) dmg *= 0.75f;
            damage(id, best, c.cur, dmg, head);
        }
        if (!knife && c.mag[c.cur] == 0) startReload(c);
    }
    void buy(Client& c, int item) {
        if (!c.n.alive || !(phase == PH_FREEZE || phase == PH_WARMUP)) return;
        int price = itemPrice(item);
        if (item == W_NONE || item == W_KNIFE || item == W_C4 || (item < W_COUNT && price <= 0)) return;
        if (!(item < W_COUNT || item == I_KEVLAR || item == I_HELMET || item == I_KIT)) return;
        int tm = itemTeam(item); if (tm >= 0 && tm != c.n.team) return;
        if (c.money < price) return;
        if (item == I_KEVLAR) { if (c.armor >= 100) return; c.armor = 100; }
        else if (item == I_HELMET) { if (c.armor >= 100 && c.helmet) return; c.armor = 100; c.helmet = true; }
        else if (item == I_KIT) { if (c.hasKit) return; c.hasKit = true; }
        else { give(c, item); c.cur = (uint8_t)item; c.reloading = false; }
        addMoney(c, -price);
    }
    void switchSlot(Client& c, int slot) {
        int w = slot == 1 ? c.pri : slot == 2 ? c.sec : slot == 3 ? W_KNIFE : (c.hasBomb ? W_C4 : 0);
        if (!w || !c.n.alive || w == c.cur) return;
        c.cur = (uint8_t)w; c.reloading = false; c.nextShot = std::max(c.nextShot, t + 0.3);
    }

    // ---------------- networking ----------------
    void fill(Client& c, PlayerNet& o) {
        o = c.n; o.curW = c.cur; o.priW = c.pri; o.secW = c.sec;
        o.flags = (c.hasKit ? FL_KIT : 0) | (c.helmet ? FL_HELMET : 0) | (c.hasBomb ? FL_BOMB : 0) | (c.reloading ? FL_RELOAD : 0);
        o.armor = (int16_t)c.armor; o.money = (int16_t)c.money; o.ammo = (int16_t)c.mag[c.cur]; o.reserve = (int16_t)c.res[c.cur];
        float need = (c.n.team == 1 && bombState == BS_PLANTED) ? (c.hasKit ? 5.f : 10.f) : PLANT_T;
        o.progress = c.prog > 0 ? (uint8_t)std::min(255.f, c.prog / need * 255.f) : 0;
    }
    void sendState() {
        StatePkt st{}; st.type = P_STATE; st.phase = (uint8_t)phase; st.round = (uint8_t)round; st.scoreT = (uint8_t)score[0]; st.scoreCT = (uint8_t)score[1];
        st.bombState = (uint8_t)bombState; st.carrier = (uint8_t)(carrier < 0 ? 255 : carrier); st.winner = (uint8_t)winner; st.reason = (uint8_t)reason;
        st.serverTime = t; st.phaseLeft = (float)std::max(0.0, phase == PH_WARMUP ? 0.0 : phaseEnd - t);
        st.bx = bombPos.x; st.by = bombPos.y; st.bz = bombPos.z; st.bombLeft = bombState == BS_PLANTED ? (float)std::max(0.0, explodeAt - t) : 0.f;
        memcpy(st.kills, kills, sizeof kills);
        Snap sn{}; sn.t = t;
        for (int i = 0; i < MAXP; i++) {
            if (cl[i].used) fill(cl[i], st.pl[i]);
            sn.p[i] = {cl[i].n.x, cl[i].n.y, cl[i].n.z}; sn.alive[i] = cl[i].used && cl[i].n.alive;
        }
        hist.push_back(sn); if (hist.size() > 40) hist.pop_front();
        for (int i = 0; i < MAXP; i++) if (cl[i].used) { st.you = (uint8_t)i; sock.send(cl[i].addr, &st, sizeof st); }
    }
    void handle(const net::Addr& from, const char* buf, int n) {
        uint8_t type = (uint8_t)buf[0];
        if (type == P_DISCOVER) {
            DiscoverReply r{}; r.type = P_DISCOVER_REPLY; for (auto& c : cl) if (c.used) r.players++;
            strncpy(r.name, name.c_str(), 23); sock.send(from, &r, sizeof r); return;
        }
        int id = -1; for (int i = 0; i < MAXP; i++) if (cl[i].used && cl[i].addr == from) id = i;
        if (id < 0) {
            if (type != P_HELLO || n < (int)sizeof(HelloPkt)) return;
            for (int i = 0; i < MAXP; i++) if (!cl[i].used) { id = i; break; }
            if (id < 0) { uint8_t f = P_FULL; sock.send(from, &f, 1); return; }
            int cnt[2] = {0, 0}; for (auto& c : cl) if (c.used) cnt[c.n.team]++;
            Client& c = cl[id]; c = Client(); c.used = true; c.addr = from; c.last = t;
            HelloPkt h; memcpy(&h, buf, sizeof h); strncpy(c.n.name, h.name, 15);
            c.n.active = 1; c.n.team = cnt[0] <= cnt[1] ? 0 : 1;
            c.money = phase == PH_WARMUP ? 16000 : 800; resetLoadout(c);
            spawnPlayer(c, rand() % 8);
            if (!(phase == PH_WARMUP || phase == PH_FREEZE)) { c.n.alive = 0; c.respawnAt = 1e18; }   // wait for next round
            printf("[server] %s joined as %s (slot %d)\n", c.n.name, c.n.team ? "CT" : "T", id);
        }
        Client& c = cl[id]; c.last = t;
        if (type == P_HELLO) {
            WelcomePkt w{}; w.type = P_WELCOME; w.id = (uint8_t)id; w.mapHash = gmap().hash; strncpy(w.map, gmap().name.c_str(), 23);
            sock.send(from, &w, sizeof w);
        } else if (type == P_UPDATE && n >= (int)sizeof(UpdatePkt)) {
            UpdatePkt u; memcpy(&u, buf, sizeof u); c.buttons = u.buttons;
            if (c.n.alive && phase != PH_FREEZE && std::isfinite(u.x) && std::isfinite(u.y) && std::isfinite(u.z)) {
                const MapData& m = gmap();
                c.n.x = std::max(m.bx0, std::min(m.bx1, u.x)); c.n.z = std::max(m.bz0, std::min(m.bz1, u.z));
                c.n.y = std::max(-1.f, std::min(60.f, u.y));
            }
            if (c.n.alive && std::isfinite(u.yaw) && std::isfinite(u.pitch)) { c.n.yaw = u.yaw; c.n.pitch = u.pitch; }
        } else if (type == P_SHOOT && n >= (int)sizeof(ShootPkt)) {
            ShootPkt s; memcpy(&s, buf, sizeof s);
            V3 d{s.dx, s.dy, s.dz}; float l = sqrtf(d.x*d.x + d.y*d.y + d.z*d.z);
            if (!(l > 0.5f) || !std::isfinite(l) || !std::isfinite(s.viewTime)) return;
            d.x /= l; d.y /= l; d.z /= l; shoot(id, d, s.viewTime);
        } else if (type == P_CMD && n >= (int)sizeof(CmdPkt)) {
            CmdPkt m; memcpy(&m, buf, sizeof m);
            if (m.cmd == C_SWITCH) switchSlot(c, m.arg);
            else if (m.cmd == C_RELOAD && c.n.alive) startReload(c);
            else if (m.cmd == C_BUY) buy(c, m.arg);
        } else if (type == P_PING && n >= (int)sizeof(PingPkt)) {
            PingPkt p; memcpy(&p, buf, sizeof p); p.type = P_PONG; sock.send(from, &p, sizeof p);
        }
    }

    // ---------------- per-tick update ----------------
    void tick(double dt) {
        for (int i = 0; i < MAXP; i++) if (cl[i].used && t - cl[i].last > 5.0) dropClient(i);
        int nT = teamCount(0), nC = teamCount(1);
        if (phase == PH_WARMUP) { if (nT > 0 && nC > 0) resetMatch(); }
        else if (nT == 0 || nC == 0) enterWarmup();
        for (auto& c : cl) if (c.used && c.n.alive && c.reloading && t >= c.reloadEnd) {
            const WeaponDef& d = wdef(c.cur); int take = std::min(d.mag - c.mag[c.cur], c.res[c.cur]);
            c.mag[c.cur] += take; c.res[c.cur] -= take; c.reloading = false;
        }
        switch (phase) {
            case PH_WARMUP:
                for (auto& c : cl) if (c.used && !c.n.alive && t >= c.respawnAt) { spawnPlayer(c, rand() % 8); c.money = 16000; }
                break;
            case PH_FREEZE: if (t >= phaseEnd) { phase = PH_LIVE; phaseEnd = t + LIVE_T; } break;
            case PH_LIVE: bombTick(dt); if (phase == PH_LIVE) checkEnd(); break;
            case PH_ROUNDEND: if (t >= phaseEnd) { if (round == 6) halftime(); startRound(); } break;
            case PH_MATCHEND: if (t >= phaseEnd) resetMatch(); break;
        }
    }
    void run() {
        double T0 = nowS(); lastT = 0;
        while (g_run) {
            t = nowS() - T0;
            net::Addr from; char buf[512]; int n;
            while ((n = sock.recv(from, buf, sizeof buf)) > 0) handle(from, buf, n);
            tick(t - lastT); lastT = t;
            if (t >= nextSend) { nextSend = t + 1.0 / 30.0; sendState(); }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
};

static void loop(std::string name) {
    Server* s = new Server(); s->name = name;
    if (!s->sock.open(PORT, false)) { printf("[server] cannot bind UDP %d\n", PORT); g_status = -1; delete s; return; }
    g_status = 1;
    printf("[server] '%s' map '%s' on UDP %d (LAN IP %s)\n", name.c_str(), gmap().name.c_str(), PORT, net::localIP().c_str());
    s->run();
    printf("[server] stopped\n");
    delete s;
}

bool serverStart(const std::string& name) {
    if (g_run) return true;
    g_status = 0; g_run = true; g_thr = std::thread(loop, name);
    for (int i = 0; i < 100 && g_status == 0; i++) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    if (g_status <= 0) { g_run = false; if (g_thr.joinable()) g_thr.join(); return false; }
    return true;
}
void serverStop() { g_run = false; if (g_thr.joinable()) g_thr.join(); }
void serverRun(const std::string& name) { g_run = true; g_status = 0; loop(name); }

} // namespace cs
