// shared.hpp - protocol, weapons, map data/loader, physics. No platform/graphics includes.
#pragma once
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <fstream>
#include <sstream>

namespace cs {

constexpr uint16_t PORT = 27015;
constexpr int   MAXP = 10;            // 5v5
constexpr float PR = 0.35f, PH = 1.8f, EYE = 1.62f, STEP = 0.6f;
constexpr float PIF = 3.14159265f;

struct V3 { float x, y, z; };
inline V3 fwdVec(float yaw, float pitch) { float cp = cosf(pitch); return { cp * sinf(yaw), sinf(pitch), -cp * cosf(yaw) }; }

// ============================== Weapons ==============================
enum : uint8_t { W_NONE = 0, W_KNIFE, W_GLOCK, W_USP, W_DEAGLE, W_MP9, W_NOVA, W_AK47, W_M4, W_AWP, W_C4, W_COUNT };
enum : uint8_t { I_KEVLAR = 40, I_HELMET = 41, I_KIT = 42 };
struct WeaponDef {
    const char* name; uint8_t slot; int price; int8_t team;   // slot: 1 primary 2 secondary 3 knife 4 bomb; team -1 both,0 T,1 CT
    float dmg, interval; int mag, reserve; float reload, spread, speed, kick, pen, rangeMod, head; int pellets; bool autoFire; int reward;
};
inline const WeaponDef& wdef(int id) {
    static const WeaponDef T[W_COUNT] = {
        {"None",     0,   0,-1,   0,1.00f, 0,  0,0.0f,0.000f,1.00f,0.000f,0.000f,1.00f,1,1,false,   0},
        {"Knife",    3,   0,-1,  40,0.50f, 0,  0,0.0f,0.000f,1.00f,0.000f,1.000f,1.00f,1,1,false,1500},
        {"Glock-18", 2,   0, 0,  30,0.15f,20,120,2.2f,0.006f,1.00f,0.010f,0.470f,0.85f,4,1,false, 300},
        {"USP-S",    2,   0, 1,  35,0.15f,12, 24,2.2f,0.005f,1.00f,0.010f,0.500f,0.85f,4,1,false, 300},
        {"Desert Eagle",2,700,-1,53,0.225f,7, 35,2.2f,0.004f,0.97f,0.045f,0.930f,0.81f,4,1,false, 300},
        {"MP9",      1,1250,-1,  26,0.07f,30,120,2.1f,0.012f,0.97f,0.008f,0.600f,0.87f,4,1,true,  600},
        {"Nova",     1,1050,-1,  26,0.88f, 8, 32,3.0f,0.045f,0.95f,0.060f,0.500f,0.70f,3,9,false, 900},
        {"AK-47",    1,2700, 0,  36,0.10f,30, 90,2.5f,0.008f,0.92f,0.014f,0.775f,0.98f,4,1,true,  300},
        {"M4A4",     1,3100, 1,  33,0.09f,30, 90,3.1f,0.007f,0.93f,0.012f,0.700f,0.97f,4,1,true,  300},
        {"AWP",      1,4750,-1, 115,1.45f, 5, 30,3.6f,0.030f,0.78f,0.050f,0.975f,0.99f,4,1,false, 100},
        {"C4",       4,   0, 0,   0,1.00f, 0,  0,0.0f,0.000f,1.00f,0.000f,0.000f,1.00f,1,1,false,   0},
    };
    return T[id < W_COUNT ? id : 0];
}
inline const char* itemName(int id) { return id == I_KEVLAR ? "Kevlar" : id == I_HELMET ? "Kevlar + Helmet" : id == I_KIT ? "Defuse Kit" : wdef(id).name; }
inline int itemPrice(int id) { return id == I_KEVLAR ? 650 : id == I_HELMET ? 1000 : id == I_KIT ? 400 : wdef(id).price; }
inline int itemTeam(int id) { return id == I_KIT ? 1 : (id >= W_COUNT ? -1 : wdef(id).team); }

// ============================== Map ==============================
struct Box { V3 mn, mx; uint8_t r, g, b; };
struct Site { char name; float x0, z0, x1, z1; };
struct Spawn { float x, z, yaw; };
struct MapData {
    std::string name = "dust_lite";
    std::vector<Box> boxes;
    std::vector<Spawn> spawns[2];       // 0 = T, 1 = CT
    std::vector<Site> sites;
    float bx0 = -39.6f, bz0 = -39.6f, bx1 = 39.6f, bz1 = 39.6f;
    uint8_t sky[3] = {135, 180, 220}, floorc[3] = {150, 140, 120};
    std::string modelPath; float modelScale = 1; V3 modelOff{0, 0, 0};   // visual model (client only)
    uint32_t hash = 0;
};
inline MapData& gmap() { static MapData m; return m; }
inline const std::vector<Box>& worldBoxes() { return gmap().boxes; }
inline void setMap(MapData m) { gmap() = std::move(m); }

inline uint32_t hashMap(const MapData& m) {
    uint32_t h = 2166136261u;
    auto mix = [&](float f) { int v = (int)lroundf(f * 100.f); for (int i = 0; i < 4; i++) { h ^= (uint8_t)(v >> (i * 8)); h *= 16777619u; } };
    for (auto& b : m.boxes) { mix(b.mn.x); mix(b.mn.y); mix(b.mn.z); mix(b.mx.x); mix(b.mx.y); mix(b.mx.z); }
    for (int t = 0; t < 2; t++) for (auto& s : m.spawns[t]) { mix(s.x); mix(s.z); mix(s.yaw); }
    for (auto& s : m.sites) { mix(s.x0); mix(s.z0); mix(s.x1); mix(s.z1); }
    mix(m.bx0); mix(m.bz0); mix(m.bx1); mix(m.bz1);
    return h;
}

inline MapData builtinMap() {
    MapData m; m.name = "dust_lite";
    auto add = [&](float x0, float y0, float z0, float x1, float y1, float z1, uint8_t r, uint8_t g, uint8_t b) { m.boxes.push_back({{x0,y0,z0},{x1,y1,z1},r,g,b}); };
    add(-41,0,-41, 41,6,-40, 150,130,100); add(-41,0,40, 41,6,41, 150,130,100);
    add(-41,0,-40,-40,6,40, 140,120,95);   add(40,0,-40, 41,6,40, 140,120,95);
    add(-40,0,-0.5f,-10,4,0.5f, 110,100,90); add(10,0,-0.5f,40,4,0.5f, 110,100,90);
    add(-4,0,-4, 4,1.0f,4, 90,95,110);
    add(-14,0,-25,-5,2.6f,-24, 170,150,110); add(5,0,-25,14,2.6f,-24, 170,150,110);
    add(-14,0,24,-5,2.6f,25, 170,150,110);   add(5,0,24,14,2.6f,25, 170,150,110);
    add(-24,0,-16,-23,3.5f,-6, 120,110,100); add(23,0,6,24,3.5f,16, 120,110,100);
    add(-24,0,6,-23,3.5f,16, 120,110,100);   add(23,0,-16,24,3.5f,-6, 120,110,100);
    add(-30,0,-30,-28,2,-28, 160,110,60); add(28,0,28,30,2,30, 160,110,60);
    add(-30,0,28,-28,2,30, 160,110,60);   add(28,0,-30,30,2,-28, 160,110,60);
    add(-20,0,10,-17,3,13, 150,100,55);   add(17,0,-13,20,3,-10, 150,100,55);
    add(-1,0,15,1,1.0f,17, 150,100,55);   add(0,0,-14,2,1.0f,-12, 150,100,55); add(2,0,-14,4,2.0f,-12, 150,100,55);
    for (int i = -2; i <= 2; i++) { m.spawns[0].push_back({i * 4.f, 34.f, 0.f}); m.spawns[1].push_back({i * 4.f, -34.f, PIF}); }
    m.sites.push_back({'A', -30, -34, -18, -22});
    m.sites.push_back({'B',  18, -34,  30, -22});
    m.hash = hashMap(m);
    return m;
}

// ---- OBJ -> voxel collision boxes ----
inline bool loadObj(const std::string& path, std::vector<V3>& v, std::vector<int>& idx) {
    std::ifstream f(path); if (!f) return false;
    std::string line;
    while (std::getline(f, line)) {
        if (line.size() < 2) continue;
        if (line[0] == 'v' && line[1] == ' ') { float x, y, z; if (sscanf(line.c_str() + 2, "%f %f %f", &x, &y, &z) == 3) v.push_back({x, y, z}); }
        else if (line[0] == 'f' && line[1] == ' ') {
            std::istringstream ss(line.substr(2)); std::string tok; std::vector<int> fi;
            while (ss >> tok) { int i = atoi(tok.c_str()); i = i < 0 ? (int)v.size() + i : i - 1; fi.push_back(i); }
            for (size_t k = 2; k < fi.size(); k++) {
                int a = fi[0], b = fi[k-1], c = fi[k], n = (int)v.size();
                if (a >= 0 && b >= 0 && c >= 0 && a < n && b < n && c < n) { idx.push_back(a); idx.push_back(b); idx.push_back(c); }
            }
        }
    }
    return !v.empty() && !idx.empty();
}
inline bool voxelizeInto(MapData& m, std::vector<V3> v, const std::vector<int>& idx, float cell, float scale, V3 off, std::string& err) {
    for (auto& p : v) { p.x = p.x * scale + off.x; p.y = p.y * scale + off.y; p.z = p.z * scale + off.z; }
    V3 mn = v[0], mx = v[0];
    for (auto& p : v) { mn.x = std::min(mn.x, p.x); mn.y = std::min(mn.y, p.y); mn.z = std::min(mn.z, p.z);
                        mx.x = std::max(mx.x, p.x); mx.y = std::max(mx.y, p.y); mx.z = std::max(mx.z, p.z); }
    mn.x = floorf(mn.x / cell) * cell; mn.y = floorf(mn.y / cell) * cell; mn.z = floorf(mn.z / cell) * cell;
    int nx = (int)ceilf((mx.x - mn.x) / cell) + 1, ny = (int)ceilf((mx.y - mn.y) / cell) + 1, nz = (int)ceilf((mx.z - mn.z) / cell) + 1;
    if ((double)nx * ny * nz > 80e6) { err = "collision mesh too large for this cell size (raise cell)"; return false; }
    std::vector<uint8_t> g((size_t)nx * ny * nz, 0);
    auto at = [&](int x, int y, int z) -> uint8_t& { return g[((size_t)y * nz + z) * nx + x]; };
    auto mark = [&](V3 p) {
        int ix = std::max(0, std::min(nx-1, (int)floorf((p.x - mn.x) / cell)));
        int iy = std::max(0, std::min(ny-1, (int)floorf((p.y - mn.y) / cell)));
        int iz = std::max(0, std::min(nz-1, (int)floorf((p.z - mn.z) / cell)));
        at(ix, iy, iz) = 1;
    };
    auto len = [](V3 a, V3 b) { return sqrtf((a.x-b.x)*(a.x-b.x) + (a.y-b.y)*(a.y-b.y) + (a.z-b.z)*(a.z-b.z)); };
    for (size_t t = 0; t + 2 < idx.size(); t += 3) {
        V3 a = v[idx[t]], b = v[idx[t+1]], c = v[idx[t+2]];
        float e = std::max(len(a, b), std::max(len(b, c), len(a, c)));
        int n = std::max(1, (int)ceilf(e / (cell * 0.5f)));
        for (int i = 0; i <= n; i++) for (int j = 0; j <= n - i; j++) {
            float u = (float)i / n, w = (float)j / n;
            mark({a.x + (b.x-a.x)*u + (c.x-a.x)*w, a.y + (b.y-a.y)*u + (c.y-a.y)*w, a.z + (b.z-a.z)*u + (c.z-a.z)*w});
        }
    }
    for (int y = 0; y < ny; y++) for (int z = 0; z < nz; z++) for (int x = 0; x < nx; x++) {
        if (at(x, y, z) != 1) continue;
        int x1 = x; while (x1 + 1 < nx && at(x1 + 1, y, z) == 1) x1++;
        int z1 = z; for (bool ok = true; ok && z1 + 1 < nz;) { for (int xx = x; xx <= x1; xx++) if (at(xx, y, z1 + 1) != 1) { ok = false; break; } if (ok) z1++; }
        int y1 = y; for (bool ok = true; ok && y1 + 1 < ny;) { for (int zz = z; zz <= z1 && ok; zz++) for (int xx = x; xx <= x1; xx++) if (at(xx, y1 + 1, zz) != 1) { ok = false; break; } if (ok) y1++; }
        for (int yy = y; yy <= y1; yy++) for (int zz = z; zz <= z1; zz++) for (int xx = x; xx <= x1; xx++) at(xx, yy, zz) = 2;
        float top = mn.y + (y1 + 1) * cell;
        if (top <= 0.001f) continue;
        m.boxes.push_back({{mn.x + x*cell, std::max(0.f, mn.y + y*cell), mn.z + z*cell}, {mn.x + (x1+1)*cell, top, mn.z + (z1+1)*cell}, 190, 190, 195});
    }
    return true;
}

// ---- .map text format ----
inline bool loadMapFile(const std::string& path, MapData& m, std::string& err) {
    std::ifstream f(path);
    if (!f) { err = "cannot open " + path; return false; }
    m = MapData(); m.boxes.clear();
    size_t sl = path.find_last_of("/\\"); std::string dir = sl == std::string::npos ? "" : path.substr(0, sl + 1);
    std::string base = path.substr(sl == std::string::npos ? 0 : sl + 1); if (base.size() > 4) base.resize(base.size() - 4);
    m.name = base;
    std::string line;
    while (std::getline(f, line)) {
        size_t h = line.find('#'); if (h != std::string::npos) line.resize(h);
        std::istringstream ss(line); std::string cmd; if (!(ss >> cmd)) continue;
        if (cmd == "box") {
            float a[6] = {0}; int c[3] = {150, 150, 150};
            for (int i = 0; i < 6; i++) ss >> a[i];
            int t; for (int i = 0; i < 3; i++) if (ss >> t) c[i] = t;
            m.boxes.push_back({{std::min(a[0],a[3]), std::min(a[1],a[4]), std::min(a[2],a[5])}, {std::max(a[0],a[3]), std::max(a[1],a[4]), std::max(a[2],a[5])}, (uint8_t)c[0], (uint8_t)c[1], (uint8_t)c[2]});
        } else if (cmd == "spawn") {
            std::string tm; float x = 0, z = 0, yd = 0; ss >> tm >> x >> z >> yd;
            m.spawns[tm == "CT" ? 1 : 0].push_back({x, z, yd * PIF / 180.f});
        } else if (cmd == "site") {
            std::string n; float a = 0, b = 0, c = 0, d = 0; ss >> n >> a >> b >> c >> d;
            m.sites.push_back({n.empty() ? 'A' : n[0], std::min(a,c), std::min(b,d), std::max(a,c), std::max(b,d)});
        } else if (cmd == "bounds") { ss >> m.bx0 >> m.bz0 >> m.bx1 >> m.bz1; }
        else if (cmd == "sky")   { int r = 0, g = 0, b = 0; ss >> r >> g >> b; m.sky[0] = r; m.sky[1] = g; m.sky[2] = b; }
        else if (cmd == "floor") { int r = 0, g = 0, b = 0; ss >> r >> g >> b; m.floorc[0] = r; m.floorc[1] = g; m.floorc[2] = b; }
        else if (cmd == "model") {
            std::string p; float s = 1, ox = 0, oy = 0, oz = 0, tmp; ss >> p; if (ss >> tmp) { s = tmp; ss >> ox >> oy >> oz; }
            m.modelPath = dir + p; m.modelScale = s; m.modelOff = {ox, oy, oz};
        } else if (cmd == "collide_obj") {
            std::string p; float cell = 0.5f, s = 1, ox = 0, oy = 0, oz = 0, tmp; ss >> p >> cell; if (ss >> tmp) { s = tmp; ss >> ox >> oy >> oz; }
            std::vector<V3> v; std::vector<int> idx;
            if (!loadObj(dir + p, v, idx)) { err = "cannot read OBJ " + dir + p; return false; }
            if (!voxelizeInto(m, v, idx, std::max(0.2f, cell), s, {ox, oy, oz}, err)) return false;
            if (m.modelPath.empty()) { m.modelPath = dir + p; m.modelScale = s; m.modelOff = {ox, oy, oz}; }
        }
    }
    if (m.spawns[0].empty() || m.spawns[1].empty()) { err = "map needs 'spawn T' and 'spawn CT' lines"; return false; }
    if (m.sites.empty()) { err = "map needs at least one 'site' line"; return false; }
    m.hash = hashMap(m);
    return true;
}
inline bool loadMapNamed(const std::string& name, const std::vector<std::string>& dirs, MapData& out, std::string& err) {
    if (name == "dust_lite") { out = builtinMap(); return true; }
    if (name.empty() || name.find_first_of("/\\.") != std::string::npos) { err = "invalid map name"; return false; }
    for (auto& d : dirs) { std::ifstream t(d + name + ".map"); if (t) return loadMapFile(d + name + ".map", out, err); }
    err = "Missing map file maps/" + name + ".map (copy it from the host)";
    return false;
}

// ============================== Physics ==============================
struct Body { V3 p{0,0,0}; float vy = 0; bool grounded = false; };
inline bool hits(const V3& p, const Box& b) {
    return p.x + PR > b.mn.x && p.x - PR < b.mx.x && p.z + PR > b.mn.z && p.z - PR < b.mx.z &&
           p.y + PH > b.mn.y && p.y < b.mx.y - 0.001f;
}
inline bool hitsAny(const V3& p) { for (auto& b : worldBoxes()) if (hits(p, b)) return true; return false; }
inline void moveBody(Body& b, float vx, float vz, bool jump, float dt) {
    auto tryMove = [&](float dx, float dz) {
        V3 q = b.p; q.x += dx; q.z += dz;
        if (!hitsAny(q)) { b.p = q; return; }
        if (b.grounded) for (float s = 0.1f; s <= STEP + 1e-4f; s += 0.1f) { V3 r = q; r.y += s; if (!hitsAny(r)) { b.p = r; return; } }
    };
    tryMove(vx * dt, 0); tryMove(0, vz * dt);
    const MapData& m = gmap();
    b.p.x = std::max(m.bx0, std::min(m.bx1, b.p.x)); b.p.z = std::max(m.bz0, std::min(m.bz1, b.p.z));
    if (jump && b.grounded) { b.vy = 7.0f; b.grounded = false; }
    b.vy -= 20.0f * dt; b.p.y += b.vy * dt; b.grounded = false;
    if (b.p.y <= 0) { b.p.y = 0; b.vy = 0; b.grounded = true; }
    for (auto& bx : worldBoxes()) if (hits(b.p, bx)) {
        if (b.vy <= 0) { b.p.y = bx.mx.y; b.vy = 0; b.grounded = true; }
        else           { b.p.y = bx.mn.y - PH - 0.001f; b.vy = 0; }
    }
}
inline bool rayBox(V3 o, V3 d, V3 mn, V3 mx, float& tout) {
    float O[3]={o.x,o.y,o.z}, D[3]={d.x,d.y,d.z}, A[3]={mn.x,mn.y,mn.z}, B[3]={mx.x,mx.y,mx.z};
    float t0 = 0, t1 = 1e9f;
    for (int i = 0; i < 3; i++) {
        if (std::fabs(D[i]) < 1e-8f) { if (O[i] < A[i] || O[i] > B[i]) return false; }
        else { float a = (A[i]-O[i])/D[i], b = (B[i]-O[i])/D[i]; if (a > b) std::swap(a, b); t0 = std::max(t0, a); t1 = std::min(t1, b); if (t0 > t1) return false; }
    }
    tout = t0; return true;
}
inline float rayWorld(V3 o, V3 d, float maxT = 200.f) {
    float best = maxT, t;
    for (auto& b : worldBoxes()) if (rayBox(o, d, b.mn, b.mx, t) && t < best) best = t;
    if (d.y < -1e-6f) { t = -o.y / d.y; if (t > 0 && t < best) best = t; }
    return best;
}
inline bool inSite(const MapData& m, float x, float z) { for (auto& s : m.sites) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return true; return false; }

// ============================== Protocol ==============================
enum : uint8_t { PH_WARMUP = 0, PH_FREEZE, PH_LIVE, PH_ROUNDEND, PH_MATCHEND };
enum : uint8_t { BS_NONE = 0, BS_CARRIED, BS_DROPPED, BS_PLANTED, BS_DEFUSED, BS_EXPLODED };
enum : uint8_t { RS_ELIM = 0, RS_BOMB, RS_DEFUSE, RS_TIME };
enum : uint8_t { FL_KIT = 1, FL_HELMET = 2, FL_BOMB = 4, FL_RELOAD = 8 };
enum : uint8_t { C_SWITCH = 1, C_RELOAD, C_BUY };
enum : uint8_t { P_HELLO = 1, P_WELCOME, P_UPDATE, P_SHOOT, P_STATE, P_FULL, P_CMD, P_PING, P_PONG, P_DISCOVER = 90, P_DISCOVER_REPLY };

#pragma pack(push, 1)
struct HelloPkt   { uint8_t type; char name[16]; };
struct WelcomePkt { uint8_t type, id; uint32_t mapHash; char map[24]; };
struct UpdatePkt  { uint8_t type; float x, y, z, yaw, pitch; uint8_t buttons; };   // buttons bit0 = USE (plant/defuse)
struct ShootPkt   { uint8_t type; float dx, dy, dz; double viewTime; };           // viewTime = server time the shooter was seeing (lag comp)
struct CmdPkt     { uint8_t type, cmd; int16_t arg; };
struct PingPkt    { uint8_t type; double t; };
struct KillEv     { uint8_t seq, killer, victim, weapon, head; };
struct PlayerNet {
    uint8_t active, team, alive, shots, spawnSeq, hits, curW, priW, secW, flags, progress;
    int16_t hp, armor, kills, deaths, money, ammo, reserve;
    float x, y, z, yaw, pitch;
    char name[16];
};
struct StatePkt {
    uint8_t type, you, phase, round, scoreT, scoreCT, bombState, carrier, winner, reason;
    double serverTime; float phaseLeft, bx, by, bz, bombLeft;
    KillEv kills[4];
    PlayerNet pl[MAXP];
};
struct DiscoverReply { uint8_t type, players; char name[24]; };
#pragma pack(pop)

} // namespace cs
