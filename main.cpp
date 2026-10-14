// main.cpp - CS-LAN client (raylib): rendering, input, prediction, snapshot interpolation, lag-comp timestamps
#include "raylib.h"
#include "rlgl.h"
#include "shared.hpp"
#include "net.hpp"
#include "server.hpp"
#include <string>
#include <vector>
#include <deque>
#include <memory>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <algorithm>

using namespace cs;

struct Tracer { V3 a, b; float life; };
struct Feed   { std::string text; float life; Color col; };
struct Snap   { double t; PlayerNet pl[MAXP]; };
struct RView  { V3 p{0,0,0}; float yaw = 0, pitch = 0; };

// ============================== assets ==============================
static std::vector<std::string> g_roots;
static std::string findFile(const std::string& rel) { for (auto& r : g_roots) { std::string p = r + rel; if (FileExists(p.c_str())) return p; } return ""; }
static std::vector<std::string> mapDirs() { std::vector<std::string> d; for (auto& r : g_roots) d.push_back(r + "maps/"); return d; }

static const char* WFILE[W_COUNT] = {"", "knife", "glock", "usp", "deagle", "mp9", "nova", "ak47", "m4", "awp", "c4"};
static const float WLEN[W_COUNT]  = {0, 0.35f, 0.30f, 0.30f, 0.35f, 0.45f, 0.70f, 0.80f, 0.80f, 1.00f, 0.30f};

struct Assets {
    Model player[2]{}; bool hasPlayer[2] = {false, false}; float pScale[2] = {1, 1}, pYoff[2] = {0, 0}, pYaw[2] = {0, 0};
    Model wpn[W_COUNT]{}; bool hasWpn[W_COUNT] = {}; float wScale[W_COUNT] = {};
    Model mapModel{}; bool hasMap = false;
    Sound sLight{}, sHeavy{}, sAwp{}, sKnife{}, sHit{}, sBeep{}, sBoom{}, sBuy{}; bool audio = false;
} A;

static bool loadModelAny(const std::string& base, Model& m, bool* isGltf = nullptr) {
    const char* ex[] = {".glb", ".gltf", ".obj", ".iqm"};
    for (auto e : ex) {
        std::string p = findFile(base + e);
        if (p.empty()) continue;
        m = LoadModel(p.c_str());
        if (IsModelValid(m)) { if (isGltf) *isGltf = (e[1] == 'g'); return true; }
    }
    return false;
}
static float frand() { return (float)rand() / (float)RAND_MAX - 0.5f; }

static Sound makeSound(float dur, float freq, float noise, float decay) {
    int sr = 22050, n = (int)(dur * sr);
    short* d = (short*)malloc(n * sizeof(short));
    for (int i = 0; i < n; i++) {
        float t = (float)i / sr, env = expf(-t * decay);
        float s = (1.f - noise) * sinf(2 * PI * freq * t * (1.f + 0.3f * env)) + noise * frand() * 2.f;
        d[i] = (short)(s * env * 18000);
    }
    Wave w{}; w.frameCount = n; w.sampleRate = sr; w.sampleSize = 16; w.channels = 1; w.data = d;
    Sound s = LoadSoundFromWave(w); UnloadWave(w); return s;
}
static void loadAssets() {
    InitAudioDevice(); A.audio = IsAudioDeviceReady();
    if (A.audio) {
        A.sLight = makeSound(0.14f, 170, 0.75f, 28); A.sHeavy = makeSound(0.20f, 110, 0.7f, 20); A.sAwp = makeSound(0.5f, 70, 0.6f, 8);
        A.sKnife = makeSound(0.08f, 500, 0.8f, 40); A.sHit = makeSound(0.06f, 1100, 0.f, 45); A.sBeep = makeSound(0.09f, 1500, 0.f, 25);
        A.sBoom = makeSound(1.6f, 45, 0.55f, 3); A.sBuy = makeSound(0.07f, 800, 0.f, 30);
    }
    const char* pf[2] = {"models/player_t", "models/player_ct"};
    for (int i = 0; i < 2; i++) {
        bool gl = false;
        if (loadModelAny(pf[i], A.player[i], &gl)) {
            BoundingBox b = GetModelBoundingBox(A.player[i]);
            float h = b.max.y - b.min.y; if (h < 0.001f) h = 1;
            A.hasPlayer[i] = true; A.pScale[i] = 1.8f / h; A.pYoff[i] = -b.min.y * A.pScale[i]; A.pYaw[i] = gl ? 180.f : 0.f;
        }
    }
    for (int w = W_KNIFE; w < W_COUNT; w++) {
        if (loadModelAny(std::string("models/weapons/") + WFILE[w], A.wpn[w])) {
            BoundingBox b = GetModelBoundingBox(A.wpn[w]);
            float L = std::max(b.max.x - b.min.x, std::max(b.max.y - b.min.y, b.max.z - b.min.z)); if (L < 0.001f) L = 1;
            A.hasWpn[w] = true; A.wScale[w] = WLEN[w] / L;
        }
    }
}
static void play(Sound& s, float vol = 1.f) { if (A.audio && s.frameCount) { SetSoundVolume(s, std::max(0.05f, std::min(1.f, vol))); PlaySound(s); } }
static void loadMapVisuals() {
    if (A.hasMap) { UnloadModel(A.mapModel); A.hasMap = false; }
    const MapData& m = gmap();
    if (!m.modelPath.empty() && FileExists(m.modelPath.c_str())) { A.mapModel = LoadModel(m.modelPath.c_str()); A.hasMap = IsModelValid(A.mapModel); }
}

// ============================== game state ==============================
struct Game {
    net::Socket sock; net::Addr srv;
    bool connected = false, haveState = false, wantLeave = false, hosting = false, mapLoaded = false;
    uint8_t myId = 0; double connectStart = 0, helloT = 0, lastRecv = 0, sendT = 0, pingT = 0; float ping = 0;
    StatePkt st{}; std::deque<Snap> snaps; double clockOff = 0, renderTime = 0, prevRender = 0; bool clockInit = false;
    RView rv[MAXP];
    uint8_t prevShots[MAXP] = {0}, prevHits = 0, prevKillSeq = 0, prevSpawn = 0, prevBomb = 0, prevPhase = 0; int prevHp = 100;
    Body me; float yaw = 0, pitch = 0, fireT = 0, kick = 0, hitmark = 0, dmgFlash = 0, speedNow = 0, boom = 0; double nextBeep = 0;
    bool scoped = false, buyOpen = false, showCol = false; int spec = -1;
    std::vector<Tracer> tracers; std::vector<Feed> feed;
    std::string name, err;
};

static Vector3 rl(V3 v) { return {v.x, v.y, v.z}; }
static std::string pname(const PlayerNet& p) { int n = 0; while (n < 16 && p.name[n]) n++; return std::string(p.name, n); }
static Color teamCol(int t) { return t == 0 ? Color{235,160,50,255} : Color{80,140,240,255}; }

static bool beginConnect(Game& g, const std::string& host) {
    g.srv = net::resolve(host, PORT);
    if (g.srv.ip == 0) { g.err = "Bad address"; return false; }
    if (!g.sock.open(0, false)) { g.err = "Could not open socket"; return false; }
    g.connectStart = GetTime(); return true;
}
static void sendCmd(Game& g, uint8_t cmd, int16_t arg) { CmdPkt p{P_CMD, cmd, arg}; g.sock.send(g.srv, &p, sizeof p); }
static Sound& shotSound(int w) { return w == W_AWP ? A.sAwp : (w == W_KNIFE ? A.sKnife : (wdef(w).slot == 1 && w != W_MP9 ? A.sHeavy : A.sLight)); }

static void pollNet(Game& g) {
    net::Addr from; char buf[2048]; int n;
    while ((n = g.sock.recv(from, buf, sizeof buf)) > 0) {
        uint8_t t = (uint8_t)buf[0]; double now = GetTime();
        if (t == P_WELCOME && n >= (int)sizeof(WelcomePkt)) {
            WelcomePkt w; memcpy(&w, buf, sizeof w); g.myId = w.id; w.map[23] = 0;
            if (!g.mapLoaded) {
                if (!g.hosting) {
                    MapData m; std::string e;
                    if (!loadMapNamed(w.map, mapDirs(), m, e)) { g.err = e; g.wantLeave = true; return; }
                    if (m.hash != w.mapHash) { g.err = std::string("Your copy of map '") + w.map + "' differs from the host's"; g.wantLeave = true; return; }
                    setMap(std::move(m));
                }
                loadMapVisuals(); g.mapLoaded = true;
            }
            g.connected = true; g.lastRecv = now;
        } else if (t == P_FULL) { g.err = "Server is full"; g.wantLeave = true; return; }
        else if (t == P_PONG && n >= (int)sizeof(PingPkt)) { PingPkt p; memcpy(&p, buf, sizeof p); g.ping = g.ping * 0.7f + (float)((now - p.t) * 1000.0) * 0.3f; }
        else if (t == P_STATE && n == (int)sizeof(StatePkt) && g.mapLoaded) {
            StatePkt s; memcpy(&s, buf, sizeof s); g.lastRecv = now;
            double off = s.serverTime - now;
            if (!g.clockInit) { g.clockOff = off; g.clockInit = true; } else g.clockOff += (off - g.clockOff) * 0.05;
            Snap sn; sn.t = s.serverTime; memcpy(sn.pl, s.pl, sizeof sn.pl);
            g.snaps.push_back(sn); while (g.snaps.size() > 24) g.snaps.pop_front();
            const PlayerNet& mp = s.pl[g.myId];
            if (!g.haveState) {
                for (int i = 0; i < MAXP; i++) g.prevShots[i] = s.pl[i].shots;
                g.prevHits = mp.hits; g.prevKillSeq = s.kills[0].seq; g.prevSpawn = mp.spawnSeq; g.prevHp = mp.hp; g.prevBomb = s.bombState; g.prevPhase = s.phase;
                g.me.p = {mp.x, mp.y, mp.z}; g.yaw = mp.yaw; g.haveState = true;
            } else {
                if (mp.spawnSeq != g.prevSpawn) { g.me.p = {mp.x, mp.y, mp.z}; g.me.vy = 0; g.yaw = mp.yaw; g.pitch = 0; g.prevSpawn = mp.spawnSeq; g.spec = -1; g.kick = 0; }
                if (mp.hits != g.prevHits) { g.hitmark = 0.25f; g.prevHits = mp.hits; play(A.sHit, 0.6f); }
                if (mp.hp < g.prevHp && mp.alive) g.dmgFlash = 0.45f;
                g.prevHp = mp.hp;
                for (int k = 3; k >= 0; k--) {                           // oldest -> newest
                    const KillEv& e = s.kills[k];
                    if (e.seq != 0 && (int8_t)(e.seq - g.prevKillSeq) > 0) {
                        std::string killer = e.killer == 255 ? "BOMB" : pname(s.pl[e.killer]);
                        bool mine = e.killer == g.myId || e.victim == g.myId;
                        g.feed.push_back({killer + "  [" + wdef(e.weapon).name + (e.head ? " HS" : "") + "]  " + pname(s.pl[e.victim]), 5.f,
                                          mine ? Color{255,230,120,255} : RAYWHITE});
                        g.prevKillSeq = e.seq;
                    }
                }
                for (int i = 0; i < MAXP; i++) {
                    if (i != g.myId && s.pl[i].active && s.pl[i].shots != g.prevShots[i]) {
                        const PlayerNet& p = s.pl[i];
                        V3 o{p.x, p.y + EYE, p.z}, d = fwdVec(p.yaw, p.pitch); float tt = rayWorld(o, d, 100.f);
                        g.tracers.push_back({{o.x + d.x*0.8f, o.y - 0.15f + d.y*0.8f, o.z + d.z*0.8f}, {o.x + d.x*tt, o.y + d.y*tt, o.z + d.z*tt}, 0.07f});
                        float dist = sqrtf((p.x-g.me.p.x)*(p.x-g.me.p.x) + (p.z-g.me.p.z)*(p.z-g.me.p.z));
                        play(shotSound(p.curW), 1.f - dist / 70.f);
                    }
                    g.prevShots[i] = s.pl[i].shots;
                }
            }
            g.st = s;
        }
    }
}

// interpolate remote players ~100 ms in the past (snapshot interpolation)
static void computeViews(Game& g, double now) {
    if (g.snaps.empty()) return;
    double rt = std::min(now + g.clockOff - 0.1, g.snaps.back().t); rt = std::max(rt, g.prevRender);
    g.prevRender = g.renderTime = rt;
    size_t k = 0; while (k < g.snaps.size() && g.snaps[k].t < rt) k++;
    const Snap& b = k < g.snaps.size() ? g.snaps[k] : g.snaps.back();
    const Snap& a = (k > 0 && k < g.snaps.size()) ? g.snaps[k - 1] : b;
    double span = b.t - a.t; float al = span > 1e-6 ? (float)std::max(0.0, std::min(1.0, (rt - a.t) / span)) : 0.f;
    for (int i = 0; i < MAXP; i++) {
        const PlayerNet &pa = a.pl[i], &pb = b.pl[i]; if (!pb.active) continue;
        float f = al; if (!pa.active) f = 1.f;
        float dx = pb.x - pa.x, dz = pb.z - pa.z; if (dx*dx + dz*dz > 36.f) f = f > 0.5f ? 1.f : 0.f;
        RView& v = g.rv[i];
        v.p = {pa.x + (pb.x - pa.x) * f, pa.y + (pb.y - pa.y) * f, pa.z + (pb.z - pa.z) * f};
        v.yaw = pa.yaw + (pb.yaw - pa.yaw) * f; v.pitch = pa.pitch + (pb.pitch - pa.pitch) * f;
    }
}

static void closeBuy(Game& g) { if (g.buyOpen) { g.buyOpen = false; DisableCursor(); } }

static void updatePlayer(Game& g, float dt, double now) {
    const PlayerNet& mp = g.st.pl[g.myId]; const uint8_t ph = g.st.phase; bool alive = mp.alive;
    g.fireT -= dt; g.hitmark -= dt; g.dmgFlash -= dt; g.boom -= dt; g.kick *= expf(-dt * 6.f);
    for (auto& t : g.tracers) t.life -= dt;
    g.tracers.erase(std::remove_if(g.tracers.begin(), g.tracers.end(), [](const Tracer& t) { return t.life <= 0; }), g.tracers.end());
    for (auto& f : g.feed) f.life -= dt;
    g.feed.erase(std::remove_if(g.feed.begin(), g.feed.end(), [](const Feed& f) { return f.life <= 0; }), g.feed.end());
    if (g.buyOpen && (!alive || !(ph == PH_FREEZE || ph == PH_WARMUP))) closeBuy(g);

    if (g.st.bombState == BS_PLANTED && now >= g.nextBeep) { play(A.sBeep, 0.8f); g.nextBeep = now + std::max(0.12f, g.st.bombLeft / 40.f); }
    if (g.st.bombState == BS_EXPLODED && g.prevBomb != BS_EXPLODED) { g.boom = 1.6f; play(A.sBoom, 1.f); }
    g.prevBomb = g.st.bombState;
    if (now - g.pingT > 1.0) { g.pingT = now; PingPkt p{P_PING, now}; g.sock.send(g.srv, &p, sizeof p); }

    if (!alive) {                                                 // spectate living teammates
        g.scoped = false;
        auto ok = [&](int i) { return i >= 0 && i < MAXP && i != g.myId && g.st.pl[i].active && g.st.pl[i].alive; };
        auto next = [&](int from, bool sameTeam) { for (int k = 1; k <= MAXP; k++) { int i = (from + k + MAXP) % MAXP; if (ok(i) && (!sameTeam || g.st.pl[i].team == mp.team)) return i; } return -1; };
        if (!ok(g.spec)) g.spec = next(g.myId, true);
        if (!ok(g.spec)) g.spec = next(g.myId, false);
        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT) && !g.buyOpen) g.spec = next(g.spec < 0 ? g.myId : g.spec, true);
        UpdatePkt u{P_UPDATE, g.me.p.x, g.me.p.y, g.me.p.z, g.yaw, g.pitch, 0};
        if (now - g.sendT >= 1.0 / 60.0) { g.sendT = now; g.sock.send(g.srv, &u, sizeof u); }
        return;
    }
    const WeaponDef& w = wdef(mp.curW);
    bool frozen = ph == PH_FREEZE || ph == PH_MATCHEND;
    if (!g.buyOpen) {
        float sens = 0.0022f * (g.scoped ? 0.35f : 1.f);
        Vector2 md = GetMouseDelta(); g.yaw += md.x * sens; g.pitch -= md.y * sens; g.pitch = std::max(-1.5f, std::min(1.5f, g.pitch));
        g.scoped = mp.curW == W_AWP && IsMouseButtonDown(MOUSE_BUTTON_RIGHT);
    } else g.scoped = false;

    float fx = sinf(g.yaw), fz = -cosf(g.yaw), rx = cosf(g.yaw), rz = sinf(g.yaw), mx = 0, mz = 0;
    if (!frozen && !g.buyOpen) {
        if (IsKeyDown(KEY_W)) { mx += fx; mz += fz; } if (IsKeyDown(KEY_S)) { mx -= fx; mz -= fz; }
        if (IsKeyDown(KEY_D)) { mx += rx; mz += rz; } if (IsKeyDown(KEY_A)) { mx -= rx; mz -= rz; }
    }
    float len = sqrtf(mx*mx + mz*mz); if (len > 0) { mx /= len; mz /= len; }
    float speed = 6.0f * w.speed * (IsKeyDown(KEY_LEFT_SHIFT) ? 0.5f : 1.f) * (g.scoped ? 0.6f : 1.f);
    g.speedNow = len > 0 ? speed : 0;
    moveBody(g.me, mx * speed, mz * speed, !frozen && !g.buyOpen && IsKeyDown(KEY_SPACE), dt);

    if (!g.buyOpen) {
        if (IsKeyPressed(KEY_ONE)) sendCmd(g, C_SWITCH, 1);
        if (IsKeyPressed(KEY_TWO)) sendCmd(g, C_SWITCH, 2);
        if (IsKeyPressed(KEY_THREE)) sendCmd(g, C_SWITCH, 3);
        if (IsKeyPressed(KEY_FOUR)) sendCmd(g, C_SWITCH, 4);
        float wm = GetMouseWheelMove();
        if (wm != 0) {
            int slots[4], n = 0; slots[n++] = 1; slots[n++] = 2; slots[n++] = 3; if (mp.flags & FL_BOMB) slots[n++] = 4;
            int cur = 0; for (int i = 0; i < n; i++) if (slots[i] == w.slot) cur = i;
            sendCmd(g, C_SWITCH, slots[((cur + (wm < 0 ? 1 : -1)) % n + n) % n]);
        }
        if (IsKeyPressed(KEY_R)) sendCmd(g, C_RELOAD, 0);
        bool melee = w.slot == 3, gun = w.slot == 1 || w.slot == 2;
        bool trig = w.autoFire ? IsMouseButtonDown(MOUSE_BUTTON_LEFT) : IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
        if (trig && g.fireT <= 0 && !frozen && (melee || (gun && mp.ammo > 0 && !(mp.flags & FL_RELOAD)))) {
            g.fireT = w.interval;
            float spr = w.spread * (1.f + g.kick) + g.speedNow * 0.0012f + (g.me.grounded ? 0.f : 0.04f);
            if (mp.curW == W_AWP) spr = g.scoped ? (g.speedNow > 0 ? 0.02f : 0.0005f) : 0.08f;
            V3 o{g.me.p.x, g.me.p.y + EYE, g.me.p.z};
            V3 d = fwdVec(g.yaw + frand() * 2 * spr, g.pitch + frand() * 2 * spr);
            ShootPkt sp{P_SHOOT, d.x, d.y, d.z, g.renderTime};          // renderTime = what I was seeing -> server rewinds enemies to it
            g.sock.send(g.srv, &sp, sizeof sp);
            play(shotSound(mp.curW), 1.f);
            if (gun) {
                for (int p = 0; p < std::min(w.pellets, 5); p++) {
                    V3 dd = w.pellets > 1 ? fwdVec(g.yaw + frand() * 2 * w.spread, g.pitch + frand() * 2 * w.spread) : d;
                    float tt = rayWorld(o, dd, 100.f);
                    g.tracers.push_back({{o.x + dd.x*0.8f, o.y - 0.15f + dd.y*0.8f, o.z + dd.z*0.8f}, {o.x + dd.x*tt, o.y + dd.y*tt, o.z + dd.z*tt}, 0.06f});
                }
                g.pitch += w.kick * 0.5f; g.yaw += frand() * w.kick * 0.3f; g.kick = std::min(2.f, g.kick + w.kick * 20.f);
            }
        }
    }
    if (IsKeyPressed(KEY_B) && (ph == PH_FREEZE || ph == PH_WARMUP)) { g.buyOpen = !g.buyOpen; if (g.buyOpen) EnableCursor(); else DisableCursor(); }

    if (now - g.sendT >= 1.0 / 60.0) {
        g.sendT = now;
        UpdatePkt u{P_UPDATE, g.me.p.x, g.me.p.y, g.me.p.z, g.yaw, g.pitch, (uint8_t)(IsKeyDown(KEY_E) ? 1 : 0)};
        g.sock.send(g.srv, &u, sizeof u);
    }
}

// ============================== drawing ==============================
static void drawWeaponModel(int w, float yawOff) {
    if (!A.hasWpn[w]) return;
    float s = A.wScale[w]; DrawModelEx(A.wpn[w], {0, 0, 0}, {0, 1, 0}, yawOff, {s, s, s}, WHITE);
}
static void drawPlayer(const Game& g, int i) {
    const PlayerNet& p = g.st.pl[i]; const RView& v = g.rv[i]; int tm = p.team ? 1 : 0;
    rlPushMatrix();
    rlTranslatef(v.p.x, v.p.y, v.p.z); rlRotatef(-v.yaw * RAD2DEG, 0, 1, 0);
    if (A.hasPlayer[tm]) {
        float s = A.pScale[tm]; DrawModelEx(A.player[tm], {0, A.pYoff[tm], 0}, {0, 1, 0}, A.pYaw[tm], {s, s, s}, WHITE);
    } else {
        Color tc = teamCol(tm), dark{40,40,50,255}, skin{225,185,150,255};
        DrawCubeV({0, 0.22f, 0}, {0.5f, 0.44f, 0.3f}, dark); DrawCubeV({0, 0.85f, 0}, {0.62f, 0.8f, 0.36f}, tc);
        DrawSphere({0, 1.62f, 0}, 0.18f, skin);
    }
    rlPushMatrix(); rlTranslatef(0.28f, 1.0f, -0.35f);
    if (A.hasWpn[p.curW]) drawWeaponModel(p.curW, A.pYaw[tm] ? 180.f : 0.f); else DrawCubeV({0, 0, 0}, {0.1f, 0.12f, 0.7f}, {30, 30, 30, 255});
    rlPopMatrix(); rlPopMatrix();
}
static bool worldToScreen(const Camera3D& cam, Vector3 p, Vector2& out) {
    Vector3 f = {cam.target.x - cam.position.x, cam.target.y - cam.position.y, cam.target.z - cam.position.z};
    Vector3 d = {p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z};
    if (f.x * d.x + f.y * d.y + f.z * d.z <= 0.1f) return false;
    out = GetWorldToScreen(p, cam); return true;
}
static void drawRadar(const Game& g, V3 vp, float vyaw) {
    const int R = 78, cx = 100, cy = 150; const float sc = R / 45.f;
    DrawCircle(cx, cy, R, {0, 0, 0, 120}); DrawCircleLines(cx, cy, R, {255, 255, 255, 100});
    float fx = sinf(vyaw), fz = -cosf(vyaw), rx = cosf(vyaw), rz = sinf(vyaw);
    auto toR = [&](float wx, float wz) {
        float dx = wx - vp.x, dz = wz - vp.z, x = (dx * rx + dz * rz) * sc, y = -(dx * fx + dz * fz) * sc, l = sqrtf(x*x + y*y);
        if (l > R - 5) { x *= (R - 5) / l; y *= (R - 5) / l; } return Vector2{cx + x, cy + y};
    };
    for (auto& s : gmap().sites) { Vector2 p = toR((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2); DrawText(TextFormat("%c", s.name), (int)p.x - 5, (int)p.y - 8, 16, YELLOW); }
    if (g.st.bombState == BS_PLANTED || g.st.bombState == BS_DROPPED) DrawCircleV(toR(g.st.bx, g.st.bz), 4, g.st.bombState == BS_PLANTED ? RED : YELLOW);
    int myTeam = g.st.pl[g.myId].team;
    for (int i = 0; i < MAXP; i++) {
        const PlayerNet& p = g.st.pl[i]; if (!p.active || !p.alive || p.team != myTeam || i == g.myId) continue;
        DrawCircleV(toR(g.rv[i].p.x, g.rv[i].p.z), 4, teamCol(p.team));
    }
    DrawTriangle({(float)cx, (float)cy - 7}, {(float)cx - 5, (float)cy + 5}, {(float)cx + 5, (float)cy + 5}, WHITE);
}
static void drawBuyMenu(Game& g) {
    const PlayerNet& me = g.st.pl[g.myId];
    int W = GetScreenWidth(), H = GetScreenHeight(), pw = 860, ph = 330, px = (W - pw) / 2, py = (H - ph) / 2;
    DrawRectangle(px, py, pw, ph, {10, 12, 18, 235}); DrawRectangleLines(px, py, pw, ph, {255, 190, 60, 255});
    DrawText(TextFormat("BUY MENU        $%d        (B to close - click to buy)", me.money), px + 20, py + 14, 24, {255, 220, 120, 255});
    static const char* cols[4] = {"PISTOLS", "SMG / SHOTGUN", "RIFLES / SNIPER", "EQUIPMENT"};
    static const std::vector<int> items[4] = {{W_DEAGLE}, {W_MP9, W_NOVA}, {W_AK47, W_M4, W_AWP}, {I_KEVLAR, I_HELMET, I_KIT}};
    Vector2 mouse = GetMousePosition();
    for (int c = 0; c < 4; c++) {
        int x = px + 20 + c * 210; DrawText(cols[c], x, py + 60, 20, GRAY);
        int y = py + 92;
        for (int id : items[c]) {
            Rectangle r{(float)x, (float)y, 195, 52};
            int tm = itemTeam(id); bool teamOk = tm < 0 || tm == me.team, afford = me.money >= itemPrice(id), ok = teamOk && afford;
            bool hover = CheckCollisionPointRec(mouse, r);
            DrawRectangleRec(r, ok ? (hover ? Color{70, 90, 60, 255} : Color{40, 50, 45, 255}) : Color{35, 35, 38, 255});
            DrawText(itemName(id), x + 8, y + 6, 20, ok ? RAYWHITE : GRAY);
            DrawText(teamOk ? TextFormat("$%d", itemPrice(id)) : (tm == 0 ? "T only" : "CT only"), x + 8, y + 28, 18, ok ? Color{120, 255, 140, 255} : Color{140, 70, 70, 255});
            if (ok && hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) { sendCmd(g, C_BUY, (int16_t)id); play(A.sBuy, 0.7f); }
            y += 60;
        }
    }
}
static void drawHud(Game& g, const Camera3D& cam, V3 vp, float vyaw, bool showScore, double now) {
    int W = GetScreenWidth(), H = GetScreenHeight(), cx = W / 2, cy = H / 2;
    const PlayerNet& me = g.st.pl[g.myId]; const WeaponDef& w = wdef(me.curW); const uint8_t ph = g.st.phase;
    if (g.dmgFlash > 0) DrawRectangle(0, 0, W, H, {200, 0, 0, (unsigned char)(std::min(1.f, g.dmgFlash * 2.f) * 110)});
    if (g.boom > 0) DrawRectangle(0, 0, W, H, {255, 240, 200, (unsigned char)(std::min(1.f, g.boom) * 200)});

    if (g.scoped) {
        DrawRing({(float)cx, (float)cy}, H * 0.46f, W * 0.9f, 0, 360, 64, BLACK);
        DrawRectangle(0, cy - 1, W, 2, BLACK); DrawRectangle(cx - 1, 0, 2, H, BLACK);
    } else if (me.alive) {
        int gap = 6 + (int)(g.speedNow * 1.2f + g.kick * 6); Color cc{80, 255, 120, 255};
        DrawRectangle(cx - gap - 10, cy - 1, 10, 2, cc); DrawRectangle(cx + gap, cy - 1, 10, 2, cc);
        DrawRectangle(cx - 1, cy - gap - 10, 2, 10, cc); DrawRectangle(cx - 1, cy + gap, 2, 10, cc);
    }
    if (g.hitmark > 0) { Color hc = WHITE; DrawLine(cx-12,cy-12,cx-5,cy-5,hc); DrawLine(cx+12,cy-12,cx+5,cy-5,hc); DrawLine(cx-12,cy+12,cx-5,cy+5,hc); DrawLine(cx+12,cy+12,cx+5,cy+5,hc); }

    // 2D weapon sprite when no viewmodel is available
    if (me.alive && !g.scoped && !A.hasWpn[me.curW]) {
        int ko = (int)(g.kick * 14);
        if (w.slot == 3) DrawRectangle(W - 320, H - 150, 24, 110, {190, 190, 200, 255});
        else if (w.slot == 4) DrawRectangle(W - 330, H - 130, 120, 70, {60, 60, 55, 255});
        else { DrawRectangle(W - 330, H - 190 + ko, w.slot == 2 ? 100 : 170, 28, {35, 35, 40, 255}); DrawRectangle(W - 250, H - 165 + ko, 36, 80, {50, 40, 30, 255}); }
    }

    // bottom bars
    DrawRectangle(20, H - 74, 330, 54, {0, 0, 0, 140});
    DrawText(TextFormat("HP %d", me.hp), 30, H - 66, 30, me.hp > 30 ? RAYWHITE : RED);
    DrawText(TextFormat("AR %d%s%s", me.armor, (me.flags & FL_HELMET) ? "+H" : "", (me.flags & FL_KIT) ? " KIT" : ""), 150, H - 62, 22, {150, 200, 255, 255});
    DrawText(TextFormat("$%d", me.money), 250, H - 62, 22, {120, 255, 140, 255});
    DrawRectangle(W - 330, H - 74, 310, 54, {0, 0, 0, 140});
    DrawText(w.name, W - 322, H - 70, 22, RAYWHITE);
    if (w.mag > 0) {
        if (me.flags & FL_RELOAD) DrawText("RELOADING", W - 322, H - 46, 22, YELLOW);
        else DrawText(TextFormat("%d / %d", me.ammo, me.reserve), W - 200, H - 66, 30, me.ammo > 0 ? RAYWHITE : RED);
    }
    {   // inventory strip
        int x = W - 330, y = H - 100; const int ids[4] = {me.priW, me.secW, W_KNIFE, (me.flags & FL_BOMB) ? W_C4 : 0};
        for (int s = 0; s < 4; s++) if (ids[s]) { bool sel = ids[s] == me.curW; DrawText(TextFormat("%d %s", s + 1, wdef(ids[s]).name), x, y, 16, sel ? Color{255, 220, 80, 255} : Color{200, 200, 200, 180}); x += MeasureText(TextFormat("%d %s", s + 1, wdef(ids[s]).name), 16) + 12; }
    }

    // top bar
    int tl = (int)ceilf(g.st.phaseLeft);
    DrawRectangle(cx - 150, 6, 300, 48, {0, 0, 0, 150});
    DrawText(TextFormat("T %d", g.st.scoreT), cx - 138, 12, 26, teamCol(0));
    DrawText(TextFormat("%d CT", g.st.scoreCT), cx + 72, 12, 26, teamCol(1));
    if (ph == PH_WARMUP) DrawText("WARMUP", cx - MeasureText("WARMUP", 22) / 2, 16, 22, YELLOW);
    else if (g.st.bombState == BS_PLANTED) { const char* s = TextFormat("BOMB %d", (int)ceilf(g.st.bombLeft)); DrawText(s, cx - MeasureText(s, 24) / 2, 14, 24, RED); }
    else { const char* s = TextFormat("%d:%02d", tl / 60, tl % 60); DrawText(s, cx - MeasureText(s, 26) / 2, 12, 26, ph == PH_FREEZE ? Color{120, 220, 255, 255} : RAYWHITE); }
    DrawText(ph == PH_FREEZE ? TextFormat("Round %d - BUY TIME (press B)", g.st.round) : TextFormat("Round %d", g.st.round), cx - 90, 34, 16, {220, 220, 220, 200});

    // kill feed
    int fy = 62; for (auto& f : g.feed) { int tw = MeasureText(f.text.c_str(), 20); DrawRectangle(W - tw - 26, fy - 2, tw + 16, 26, {0, 0, 0, 150}); DrawText(f.text.c_str(), W - tw - 18, fy, 20, f.col); fy += 28; }
    DrawText(TextFormat("%d FPS  %d ms", GetFPS(), (int)g.ping), 10, 8, 18, {255, 255, 255, 170});
    if (g.hosting) DrawText(TextFormat("Hosting - friends join: %s", net::localIP().c_str()), 10, 30, 18, {255, 255, 120, 220});
    drawRadar(g, vp, vyaw);

    // site labels
    for (auto& s : gmap().sites) { Vector2 p; if (worldToScreen(cam, {(s.x0 + s.x1) / 2, 2.5f, (s.z0 + s.z1) / 2}, p)) DrawText(TextFormat("%c", s.name), (int)p.x - 10, (int)p.y - 16, 40, {255, 230, 80, 220}); }

    // plant / defuse prompt + progress
    if (me.alive && ph == PH_LIVE) {
        const char* prompt = nullptr;
        if ((me.flags & FL_BOMB) && g.st.bombState == BS_CARRIED && inSite(gmap(), g.me.p.x, g.me.p.z)) prompt = "Hold E to PLANT the bomb";
        else if (me.team == 1 && g.st.bombState == BS_PLANTED && fabsf(g.me.p.x - g.st.bx) < 1.8f && fabsf(g.me.p.z - g.st.bz) < 1.8f) prompt = "Hold E to DEFUSE";
        else if ((me.flags & FL_BOMB) && g.st.bombState == BS_CARRIED) prompt = "You carry the bomb - go to site A or B";
        if (prompt) DrawText(prompt, cx - MeasureText(prompt, 24) / 2, cy + 120, 24, {255, 230, 100, 255});
        if (me.progress > 0) { DrawRectangle(cx - 150, cy + 160, 300, 18, {0, 0, 0, 180}); DrawRectangle(cx - 148, cy + 162, (int)(296 * me.progress / 255.f), 14, {255, 200, 60, 255}); }
    }
    if (!me.alive && ph != PH_WARMUP) {
        const char* s = g.spec >= 0 ? TextFormat("SPECTATING %s  (click = next)", pname(g.st.pl[g.spec]).c_str()) : "YOU DIED";
        DrawText(s, cx - MeasureText(s, 28) / 2, H - 130, 28, {255, 120, 120, 255});
    } else if (!me.alive) DrawText("Respawning...", cx - 80, cy - 60, 30, RED);

    // round banner
    if (ph == PH_ROUNDEND || ph == PH_MATCHEND) {
        static const char* why[4] = {"all enemies eliminated", "the bomb exploded", "the bomb was defused", "time ran out"};
        const char* head = g.st.winner == 0 ? "TERRORISTS WIN" : "COUNTER-TERRORISTS WIN";
        if (ph == PH_MATCHEND) head = TextFormat("%s THE MATCH", g.st.winner == 0 ? "TERRORISTS WIN" : "COUNTER-TERRORISTS WIN");
        DrawRectangle(0, cy - 160, W, 90, {0, 0, 0, 150});
        DrawText(head, cx - MeasureText(head, 40) / 2, cy - 150, 40, teamCol(g.st.winner ? 1 : 0));
        const char* s = why[g.st.reason & 3]; DrawText(s, cx - MeasureText(s, 22) / 2, cy - 100, 22, RAYWHITE);
    }
    if (g.buyOpen) drawBuyMenu(g);
    if (!g.connected || !g.haveState) DrawText("Connecting...", cx - 80, cy, 30, YELLOW);
    if (showScore) {
        std::vector<int> idx; for (int i = 0; i < MAXP; i++) if (g.st.pl[i].active) idx.push_back(i);
        std::sort(idx.begin(), idx.end(), [&](int a, int b) { const PlayerNet &x = g.st.pl[a], &y = g.st.pl[b]; return x.team != y.team ? x.team < y.team : x.kills > y.kills; });
        int pw = 620, phh = 80 + (int)idx.size() * 28, px = cx - pw / 2, py = H / 2 - phh / 2;
        DrawRectangle(px, py, pw, phh, {0, 0, 0, 200});
        DrawText(TextFormat("SCOREBOARD   T %d : %d CT", g.st.scoreT, g.st.scoreCT), px + 16, py + 12, 24, RAYWHITE);
        DrawText("K", px + pw - 130, py + 16, 20, GRAY); DrawText("D", px + pw - 70, py + 16, 20, GRAY);
        int y = py + 52;
        for (int i : idx) {
            const PlayerNet& p = g.st.pl[i]; Color c = p.alive ? teamCol(p.team) : Color{110, 110, 110, 255};
            DrawText(pname(p).c_str(), px + 16, y, 22, c);
            if (p.team == me.team) DrawText(TextFormat("$%d", p.money), px + 330, y, 20, {120, 255, 140, 255});
            DrawText(TextFormat("%d", p.kills), px + pw - 130, y, 22, RAYWHITE); DrawText(TextFormat("%d", p.deaths), px + pw - 70, y, 22, RAYWHITE);
            y += 28;
        }
    }
    (void)now;
}

static void drawFrame(Game& g, bool showScore, double now) {
    const PlayerNet& me = g.st.pl[g.myId];
    V3 vp = g.me.p; float vyaw = g.yaw, vpitch = g.pitch; float eye = EYE;
    if (!me.alive) {
        if (g.spec >= 0) { vp = g.rv[g.spec].p; vyaw = g.rv[g.spec].yaw; vpitch = g.rv[g.spec].pitch; } else eye = 0.4f;
    }
    Camera3D cam{}; cam.position = {vp.x, vp.y + eye, vp.z};
    V3 f = fwdVec(vyaw, vpitch); cam.target = {cam.position.x + f.x, cam.position.y + f.y, cam.position.z + f.z};
    cam.up = {0, 1, 0}; cam.fovy = g.scoped ? 22.f : 75.f; cam.projection = CAMERA_PERSPECTIVE;
    const MapData& m = gmap();
    BeginDrawing();
    ClearBackground({m.sky[0], m.sky[1], m.sky[2], 255});
    BeginMode3D(cam);
    DrawPlane({0, -0.02f, 0}, {160, 160}, {m.floorc[0], m.floorc[1], m.floorc[2], 255});
    if (A.hasMap) { float s = m.modelScale; DrawModelEx(A.mapModel, {m.modelOff.x, m.modelOff.y, m.modelOff.z}, {0, 1, 0}, 0, {s, s, s}, WHITE); }
    if (!A.hasMap || g.showCol) {
        for (auto& b : m.boxes) {
            Vector3 c{(b.mn.x + b.mx.x) / 2, (b.mn.y + b.mx.y) / 2, (b.mn.z + b.mx.z) / 2}, s{b.mx.x - b.mn.x, b.mx.y - b.mn.y, b.mx.z - b.mn.z};
            if (!A.hasMap) DrawCubeV(c, s, {b.r, b.g, b.b, 255});
            DrawCubeWiresV(c, s, A.hasMap ? Color{255, 0, 255, 160} : Color{0, 0, 0, 90});
        }
    }
    for (int i = 0; i < MAXP; i++) if (i != g.myId && g.st.pl[i].active && g.st.pl[i].alive && !(i == g.spec && !me.alive)) drawPlayer(g, i);
    for (auto& t : g.tracers) DrawLine3D(rl(t.a), rl(t.b), {255, 230, 120, 255});
    if (g.st.bombState == BS_PLANTED || g.st.bombState == BS_DROPPED) {
        V3 b{g.st.bx, g.st.by, g.st.bz}; DrawCubeV({b.x, b.y + 0.12f, b.z}, {0.4f, 0.22f, 0.3f}, {55, 55, 50, 255});
        if (g.st.bombState == BS_PLANTED && fmod(now * 3.0, 1.0) < 0.2) DrawSphere({b.x, b.y + 0.28f, b.z}, 0.06f, RED);
    }
    for (auto& s : m.sites) DrawCubeV({(s.x0 + s.x1) / 2, 0.03f, (s.z0 + s.z1) / 2}, {s.x1 - s.x0, 0.05f, s.z1 - s.z0}, {255, 220, 60, 45});
    if (g.boom > 0) { float r = (1.6f - g.boom) * 9.f; DrawSphere({g.st.bx, g.st.by + 1, g.st.bz}, r, {255, 140, 30, (unsigned char)(std::min(1.f, g.boom) * 150)}); }
    if (me.alive && !g.scoped && A.hasWpn[me.curW]) {                         // 3D viewmodel (only if a model file exists)
        rlPushMatrix(); rlTranslatef(cam.position.x, cam.position.y, cam.position.z);
        rlRotatef(-vyaw * RAD2DEG, 0, 1, 0); rlRotatef(vpitch * RAD2DEG, 1, 0, 0);
        rlTranslatef(0.22f, -0.2f, -0.45f + g.kick * 0.03f); drawWeaponModel(me.curW, 180.f); rlPopMatrix();
    }
    EndMode3D();
    drawHud(g, cam, vp, vyaw, showScore, now);
    EndDrawing();
}

// ============================== main ==============================
int main(int argc, char** argv) {
    std::string name = "Player", mapArg = "dust_lite"; bool dedicated = false;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--dedicated") dedicated = true;
        else if (a == "--name" && i + 1 < argc) name = argv[++i];
        else if (a == "--map" && i + 1 < argc) mapArg = argv[++i];
    }
    if (name.size() > 15) name.resize(15);
    g_roots = {"", GetApplicationDirectory()};
    if (dedicated) {
        MapData m; std::string e;
        if (!loadMapNamed(mapArg, mapDirs(), m, e)) { printf("map error: %s\n", e.c_str()); return 1; }
        setMap(std::move(m)); printf("Loaded map '%s' (%zu collision boxes)\n", gmap().name.c_str(), gmap().boxes.size());
        cs::serverRun(name + "'s server"); return 0;
    }
    InitWindow(1280, 720, "CS-LAN  (C++ / raylib)");
    SetExitKey(KEY_NULL); SetTargetFPS(144);
    loadAssets();

    std::vector<std::string> maps = {"dust_lite"};
    for (auto& d : mapDirs()) for (auto& f : net::listFiles(d, ".map")) if (std::find(maps.begin(), maps.end(), f) == maps.end()) maps.push_back(f);
    int mapSel = (int)(std::find(maps.begin(), maps.end(), mapArg) - maps.begin()); if (mapSel >= (int)maps.size()) mapSel = 0;

    enum { MENU, PLAY } screen = MENU;
    std::unique_ptr<Game> gp; std::string ip, status; net::Socket dsock; bool searching = false; double searchStart = 0;

    auto leave = [&](const std::string& msg) {
        if (gp) { gp->sock.close(); if (gp->hosting) cs::serverStop(); gp.reset(); }
        if (A.hasMap) { UnloadModel(A.mapModel); A.hasMap = false; }
        EnableCursor(); screen = MENU; status = msg;
    };
    auto start = [&](const std::string& host, bool hosting) {
        gp = std::make_unique<Game>(); gp->name = name; gp->hosting = hosting;
        if (!beginConnect(*gp, host)) { std::string e = gp->err; gp.reset(); if (hosting) cs::serverStop(); status = e; return; }
        screen = PLAY; DisableCursor();
    };

    while (!WindowShouldClose()) {
        float dt = std::min(GetFrameTime(), 0.05f); double now = GetTime();
        if (screen == MENU) {
            int c; while ((c = GetCharPressed()) > 0) if (((c >= '0' && c <= '9') || c == '.') && ip.size() < 21) ip += (char)c;
            if (IsKeyPressed(KEY_BACKSPACE) && !ip.empty()) ip.pop_back();
            if (IsKeyPressed(KEY_M)) mapSel = (mapSel + 1) % (int)maps.size();
            if (IsKeyPressed(KEY_H)) {
                MapData m; std::string e;
                if (!loadMapNamed(maps[mapSel], mapDirs(), m, e)) status = "Map error: " + e;
                else { setMap(std::move(m)); if (cs::serverStart(name + "'s server")) start("127.0.0.1", true); else status = "Could not start server (is UDP 27015 already in use?)"; if (gp) gp->hosting = true; }
            }
            if (IsKeyPressed(KEY_ENTER) && !ip.empty()) start(ip, false);
            if (IsKeyPressed(KEY_F) && !searching && dsock.open(0, true)) {
                uint8_t q = P_DISCOVER; dsock.send(net::broadcastAddr(PORT), &q, 1); searching = true; searchStart = now; status = "Searching LAN...";
            }
            if (searching) {
                net::Addr from; char b[256]; int n;
                while ((n = dsock.recv(from, b, sizeof b)) > 0) {
                    if ((uint8_t)b[0] == P_DISCOVER_REPLY && n >= (int)sizeof(DiscoverReply)) {
                        DiscoverReply r; memcpy(&r, b, sizeof r); r.name[23] = 0; ip = net::ipString(from);
                        status = std::string("Found: ") + r.name + " (" + std::to_string(r.players) + " players) - press ENTER to join";
                        searching = false; dsock.close(); break;
                    }
                }
                if (searching && now - searchStart > 2.0) { searching = false; dsock.close(); status = "No LAN games found - type the host's IP."; }
            }
            BeginDrawing(); ClearBackground({18, 20, 26, 255});
            DrawText("CS-LAN", 80, 60, 80, {255, 190, 60, 255});
            DrawText("Bomb defusal  |  buy menu  |  lag-compensated shooting  |  custom maps & models", 84, 150, 22, GRAY);
            DrawText(TextFormat("Player: %s", name.c_str()), 84, 210, 26, RAYWHITE);
            DrawText(TextFormat("[M]  Map: %s", maps[mapSel].c_str()), 84, 260, 26, {255, 220, 120, 255});
            DrawText("[H]  Host a LAN game", 84, 305, 28, RAYWHITE);
            DrawText("[F]  Find LAN games", 84, 345, 28, RAYWHITE);
            DrawText("Join IP:", 84, 400, 28, RAYWHITE);
            DrawRectangle(240, 394, 360, 40, {40, 44, 54, 255});
            DrawText((ip + ((int)(now * 2) % 2 ? "_" : "")).c_str(), 250, 400, 28, {120, 255, 160, 255});
            DrawText("[ENTER]  Join", 84, 450, 28, RAYWHITE);
            DrawText(status.c_str(), 84, 510, 22, {255, 220, 120, 255});
            DrawText("WASD move | Shift walk | Space jump | LMB shoot | RMB scope (AWP) | R reload | 1-4 / wheel weapons", 84, 610, 20, GRAY);
            DrawText("B buy menu (freeze time) | E hold to plant/defuse | TAB scoreboard | F2 collision debug | ESC leave", 84, 636, 20, GRAY);
            DrawText("T: plant the bomb at A/B.  CT: stop them / defuse.  First to 7 rounds wins.", 84, 668, 20, GRAY);
            EndDrawing();
        } else {
            Game& g = *gp;
            if (IsKeyPressed(KEY_ESCAPE)) { if (g.buyOpen) closeBuy(g); else { leave("Disconnected."); continue; } }
            pollNet(g);
            if (g.wantLeave) { leave(g.err); continue; }
            if (!g.connected && now - g.helloT > 0.5) { g.helloT = now; HelloPkt h{}; h.type = P_HELLO; strncpy(h.name, g.name.c_str(), 15); g.sock.send(g.srv, &h, sizeof h); }
            if (!g.connected && now - g.connectStart > 6.0) { leave("No response from server."); continue; }
            if (g.haveState && now - g.lastRecv > 5.0) { leave("Connection lost."); continue; }
            if (IsKeyPressed(KEY_F2)) g.showCol = !g.showCol;
            if (g.haveState) { computeViews(g, now); updatePlayer(g, dt, now); drawFrame(g, IsKeyDown(KEY_TAB), now); }
            else { BeginDrawing(); ClearBackground(BLACK); DrawText("Connecting...", 560, 340, 32, YELLOW); EndDrawing(); }
        }
    }
    if (gp) { gp->sock.close(); if (gp->hosting) cs::serverStop(); }
    CloseAudioDevice(); CloseWindow();
    return 0;
}
