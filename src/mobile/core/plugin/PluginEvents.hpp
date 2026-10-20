#pragma once

#include "../Plugins.hpp"

#include <chrono>
#include <optional>
#include <string>

// The host's side of the event channel in Plugins.hpp: emit() is fire-and-forget, ask()
// blocks the calling (plugin) thread until the app answers or the wait runs out.
namespace Slic3r { namespace Mobile { namespace plugin_events {

void set_sink(std::function<void(const PluginEvent&)> sink);
bool has_sink();

void emit(PluginEvent event);

// Assigns the request id, emits, and waits. Empty when no sink is installed or the app
// did not answer in time.
std::optional<std::string> ask(PluginEvent event, std::chrono::milliseconds timeout);

void answer(long request_id, const std::string& value);

}}} // namespace Slic3r::Mobile::plugin_events
