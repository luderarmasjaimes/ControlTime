#include "ws_broadcast.hpp"
#include "websocket_session.hpp"

#include <algorithm>

WsRegistry &WsRegistry::instance() {
    static WsRegistry inst;
    return inst;
}

void WsRegistry::add(const std::string &tenantId, std::shared_ptr<WebSocketSession> session) {
    std::lock_guard<std::mutex> lock(mutex_);
    byTenant_[tenantId].push_back(session);
}

void WsRegistry::remove(const std::string &tenantId, WebSocketSession *rawPtr) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = byTenant_.find(tenantId);
    if (it == byTenant_.end()) return;
    auto &vec = it->second;
    vec.erase(std::remove_if(vec.begin(), vec.end(),
                             [&](const std::weak_ptr<WebSocketSession> &w) {
                                 auto sp = w.lock();
                                 return !sp || sp.get() == rawPtr;
                             }),
              vec.end());
    if (vec.empty()) byTenant_.erase(it);
}

std::size_t WsRegistry::broadcastToTenant(const std::string &tenantId, const std::string &payload) {
    std::vector<std::shared_ptr<WebSocketSession>> targets;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = byTenant_.find(tenantId);
        if (it == byTenant_.end()) return 0;
        auto &vec = it->second;
        // Limpieza perezosa de weak_ptr expirados mientras recorremos.
        vec.erase(std::remove_if(vec.begin(), vec.end(),
                                 [&](const std::weak_ptr<WebSocketSession> &w) {
                                     auto sp = w.lock();
                                     if (sp) targets.push_back(sp);
                                     return !sp;
                                 }),
                  vec.end());
    }
    for (auto &sp : targets) sp->sendAsync(payload);
    return targets.size();
}

std::size_t WsRegistry::activeCount(const std::string &tenantId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = byTenant_.find(tenantId);
    return it == byTenant_.end() ? 0 : it->second.size();
}

std::vector<std::string> WsRegistry::tenantsWithListeners() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> out;
    out.reserve(byTenant_.size());
    for (auto &kv : byTenant_) {
        if (!kv.second.empty()) out.push_back(kv.first);
    }
    return out;
}
