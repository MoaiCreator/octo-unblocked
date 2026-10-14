#pragma once
#include <string>
namespace cs {
bool serverStart(const std::string& name);  // run server in background thread (listen-server host)
void serverStop();
void serverRun(const std::string& name);    // blocking (dedicated server)
}
