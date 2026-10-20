#include "PluginEvents.hpp"

#include <future>
#include <map>
#include <mutex>

namespace Slic3r { namespace Mobile { namespace plugin_events {

namespace {

std::mutex                             s_mutex;
std::function<void(const PluginEvent&)> s_sink;
long                                   s_next_id = 1;
std::map<long, std::promise<std::string>> s_pending;

} // namespace

void set_sink(std::function<void(const PluginEvent&)> sink)
{
    std::lock_guard<std::mutex> lock(s_mutex);
    s_sink = std::move(sink);
}

bool has_sink()
{
    std::lock_guard<std::mutex> lock(s_mutex);
    return static_cast<bool>(s_sink);
}

void emit(PluginEvent event)
{
    std::function<void(const PluginEvent&)> sink;
    {
        std::lock_guard<std::mutex> lock(s_mutex);
        sink = s_sink;
    }
    if (sink)
        sink(event);
}

std::optional<std::string> ask(PluginEvent event, std::chrono::milliseconds timeout)
{
    std::function<void(const PluginEvent&)> sink;
    std::future<std::string>               reply;
    {
        std::lock_guard<std::mutex> lock(s_mutex);
        if (!s_sink)
            return std::nullopt;
        sink             = s_sink;
        event.request_id = s_next_id++;
        reply            = s_pending[event.request_id].get_future();
    }
    sink(event);
    if (reply.wait_for(timeout) != std::future_status::ready) {
        std::lock_guard<std::mutex> lock(s_mutex);
        s_pending.erase(event.request_id);
        return std::nullopt;
    }
    return reply.get();
}

void answer(long request_id, const std::string& value)
{
    std::lock_guard<std::mutex> lock(s_mutex);
    auto it = s_pending.find(request_id);
    if (it == s_pending.end())
        return;
    it->second.set_value(value);
    s_pending.erase(it);
}

}}} // namespace Slic3r::Mobile::plugin_events
