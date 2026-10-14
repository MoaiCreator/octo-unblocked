// net.hpp - tiny cross-platform non-blocking UDP wrapper
#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace net {
struct Addr {
    uint32_t ip = 0;      // network byte order
    uint16_t port = 0;    // host byte order
    bool operator==(const Addr& o) const { return ip == o.ip && port == o.port; }
};
class Socket {
public:
    Socket() = default;
    ~Socket() { close(); }
    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;
    bool open(uint16_t bindPort, bool broadcast);
    void close();
    bool send(const Addr& to, const void* data, int len);
    int  recv(Addr& from, void* buf, int cap);   // <=0 means nothing available
private:
    unsigned long long s_ = 0;
    bool open_ = false;
};
Addr        resolve(const std::string& host, uint16_t port);
Addr        broadcastAddr(uint16_t port);
std::string ipString(const Addr& a);
std::string localIP();
std::vector<std::string> listFiles(const std::string& dir, const std::string& ext); // basenames without ext
}
