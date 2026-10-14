#include "net.hpp"
#include <cstring>
#include <algorithm>
#include <cstdio>
#include <filesystem>
#ifdef _WIN32
  #define WIN32_LEAN_AND_MEAN
  #define NOMINMAX
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #ifdef _MSC_VER
    #pragma comment(lib, "ws2_32.lib")
  #endif
  typedef SOCKET sock_t; typedef int slen_t;
  #define CLOSESOCK closesocket
  #ifndef SIO_UDP_CONNRESET
    #define SIO_UDP_CONNRESET _WSAIOW(IOC_VENDOR, 12)
  #endif
  namespace { struct WsaInit { WsaInit() { WSADATA d; WSAStartup(MAKEWORD(2,2), &d); } } wsaInit; }
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #include <unistd.h>
  #include <fcntl.h>
  #include <netdb.h>
  typedef int sock_t; typedef socklen_t slen_t;
  #define INVALID_SOCKET (-1)
  #define CLOSESOCK ::close
#endif

namespace net {

bool Socket::open(uint16_t port, bool broadcast) {
    close();
    sock_t s = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return false;
    int yes = 1;
    if (broadcast) setsockopt(s, SOL_SOCKET, SO_BROADCAST, (const char*)&yes, sizeof yes);
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(port); a.sin_addr.s_addr = htonl(INADDR_ANY);
    if (::bind(s, (sockaddr*)&a, sizeof a) != 0) { CLOSESOCK(s); return false; }
#ifdef _WIN32
    u_long nb = 1; ioctlsocket(s, FIONBIO, &nb);
    BOOL off = FALSE; DWORD ret = 0;
    WSAIoctl(s, SIO_UDP_CONNRESET, &off, sizeof off, NULL, 0, &ret, NULL, NULL);
#else
    fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK);
#endif
    s_ = (unsigned long long)s; open_ = true;
    return true;
}
void Socket::close() { if (open_) { CLOSESOCK((sock_t)s_); open_ = false; } }

bool Socket::send(const Addr& to, const void* data, int len) {
    if (!open_) return false;
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(to.port); a.sin_addr.s_addr = to.ip;
    return ::sendto((sock_t)s_, (const char*)data, len, 0, (sockaddr*)&a, sizeof a) == len;
}
int Socket::recv(Addr& from, void* buf, int cap) {
    if (!open_) return -1;
    sockaddr_in a{}; slen_t l = sizeof a;
    int n = (int)::recvfrom((sock_t)s_, (char*)buf, cap, 0, (sockaddr*)&a, &l);
    if (n > 0) { from.ip = a.sin_addr.s_addr; from.port = ntohs(a.sin_port); }
    return n;
}

Addr resolve(const std::string& host, uint16_t port) {
    Addr r; r.port = port;
    addrinfo hints{}; hints.ai_family = AF_INET; hints.ai_socktype = SOCK_DGRAM;
    addrinfo* res = nullptr;
    if (getaddrinfo(host.c_str(), nullptr, &hints, &res) == 0 && res) {
        r.ip = ((sockaddr_in*)res->ai_addr)->sin_addr.s_addr;
        freeaddrinfo(res);
    }
    return r;
}
Addr broadcastAddr(uint16_t port) { Addr a; a.ip = 0xFFFFFFFFu; a.port = port; return a; }
std::string ipString(const Addr& a) {
    const uint8_t* b = (const uint8_t*)&a.ip; char buf[32];
    snprintf(buf, sizeof buf, "%d.%d.%d.%d", b[0], b[1], b[2], b[3]);
    return buf;
}
std::string localIP() {   // finds the LAN interface address (no packet is actually sent)
    sock_t s = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (s == INVALID_SOCKET) return "127.0.0.1";
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(80); a.sin_addr.s_addr = inet_addr("8.8.8.8");
    std::string r = "127.0.0.1";
    if (::connect(s, (sockaddr*)&a, sizeof a) == 0) {
        sockaddr_in l{}; slen_t len = sizeof l;
        if (getsockname(s, (sockaddr*)&l, &len) == 0) { Addr t; t.ip = l.sin_addr.s_addr; r = ipString(t); }
    }
    CLOSESOCK(s);
    return r;
}
std::vector<std::string> listFiles(const std::string& dir, const std::string& ext) {
    std::vector<std::string> r; std::error_code ec;
    for (auto& e : std::filesystem::directory_iterator(dir, ec)) {
        if (ec) break;
        if (e.path().extension().string() == ext) r.push_back(e.path().stem().string());
    }
    std::sort(r.begin(), r.end());
    return r;
}
}
