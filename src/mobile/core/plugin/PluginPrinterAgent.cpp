#include "../Plugins.hpp"
#include "PluginEvents.hpp"

#include <slic3r/plugin/PluginManager.hpp>
#include <slic3r/plugin/PythonPluginInterface.hpp>
#include <slic3r/plugin/pluginTypes/printerAgent/PrinterAgentPluginCapability.hpp>

#include <boost/log/trivial.hpp>
#include <nlohmann/json.hpp>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>

// A printer-connection capability driven the way NetworkAgentFactory drives it on the
// desktop, for the app's printer screens: connect, send a message, start a local print.
// The plugin owns the connection; what it reports through set_on_message_fn becomes
// agent-message events, and a print's progress agent-print events. Everything else on
// IPrinterAgent (binding, certificates, discovery, filament sync) stays unused here.

namespace Slic3r { namespace Mobile { namespace Plugins {

namespace {

using json = nlohmann::json;

std::mutex                                       s_mutex;
std::map<std::string, std::shared_ptr<std::atomic<bool>>> s_cancel; // "key\ncap" -> cancel flag of the print in flight

std::shared_ptr<PrinterAgentPluginCapability> agent(const std::string& key, const std::string& capability, std::string& error)
{
    auto cap = PluginManager::instance().get_plugin_capability(
        PluginCapabilityId{PluginCapabilityType::PrinterConnection, capability, key}, /*only_enabled=*/false);
    auto out = std::dynamic_pointer_cast<PrinterAgentPluginCapability>(cap);
    if (!out)
        error = "The plugin has no printer connection called " + capability + " or is not loaded.";
    return out;
}

template<typename Fn> std::string guarded(const char* what, Fn&& fn)
{
    try {
        const int code = fn();
        return code == 0 ? std::string() : std::string(what) + " failed with code " + std::to_string(code);
    } catch (const std::exception& ex) {
        BOOST_LOG_TRIVIAL(error) << what << " raised: " << ex.what();
        return std::string(what) + " raised: " + ex.what();
    } catch (...) {
        return std::string(what) + " failed.";
    }
}

std::shared_ptr<std::atomic<bool>> cancel_flag(const std::string& key, const std::string& capability)
{
    std::lock_guard<std::mutex> lock(s_mutex);
    auto& flag = s_cancel[key + "\n" + capability];
    if (!flag)
        flag = std::make_shared<std::atomic<bool>>(false);
    return flag;
}

} // namespace

std::string agent_info(const std::string& key, const std::string& capability)
{
    std::string error;
    auto        a = agent(key, capability, error);
    if (!a)
        return json{{"error", error}}.dump();
    try {
        const AgentInfo info = a->get_agent_info();
        return json{{"id", info.id}, {"name", info.name}, {"version", info.version}, {"description", info.description}}.dump();
    } catch (const std::exception& ex) {
        return json{{"error", ex.what()}}.dump();
    }
}

std::string agent_connect(const std::string& key, const std::string& capability, const std::string& dev_id,
                          const std::string& dev_ip, const std::string& username, const std::string& password, bool use_ssl)
{
    std::string error;
    auto        a = agent(key, capability, error);
    if (!a)
        return error;
    auto relay = [key, capability](const std::string& id, const std::string& msg) {
        plugin_events::emit({"agent-message", key, capability, json{{"dev_id", id}, {"message", msg}}.dump()});
    };
    error = guarded("set_queue_on_main_fn", [&] { return a->set_queue_on_main_fn([](std::function<void()> fn) { fn(); }); });
    if (error.empty())
        error = guarded("set_on_message_fn", [&] { return a->set_on_message_fn(relay); });
    if (error.empty())
        error = guarded("set_on_local_message_fn", [&] { return a->set_on_local_message_fn(relay); });
    if (error.empty())
        error = guarded("connect_printer", [&] { return a->connect_printer(dev_id, dev_ip, username, password, use_ssl); });
    return error;
}

std::string agent_disconnect(const std::string& key, const std::string& capability)
{
    std::string error;
    auto        a = agent(key, capability, error);
    if (!a)
        return error;
    return guarded("disconnect_printer", [&] { return a->disconnect_printer(); });
}

std::string agent_send(const std::string& key, const std::string& capability, const std::string& dev_id, const std::string& message_json)
{
    std::string error;
    auto        a = agent(key, capability, error);
    if (!a)
        return error;
    return guarded("send_message_to_printer", [&] { return a->send_message_to_printer(dev_id, message_json, /*qos=*/0, /*flag=*/0); });
}

std::string agent_print(const std::string& key, const std::string& capability, const std::string& params_json)
{
    std::string error;
    auto        a = agent(key, capability, error);
    if (!a)
        return error;
    json p = json::parse(params_json, nullptr, false);
    if (!p.is_object())
        return "The print parameters are not a JSON object.";

    PrintParams params{};
    params.dev_id           = p.value("dev_id", "");
    params.dev_name         = p.value("dev_name", "");
    params.dev_ip           = p.value("dev_ip", "");
    params.username         = p.value("username", "");
    params.password         = p.value("password", "");
    params.use_ssl_for_ftp  = p.value("use_ssl", false);
    params.use_ssl_for_mqtt = p.value("use_ssl", false);
    params.filename         = p.value("filename", "");
    params.dst_file         = p.value("dst_file", "");
    params.task_name        = p.value("task_name", "");
    params.project_name     = p.value("project_name", "");
    params.print_type       = p.value("print_type", "local");
    params.connection_type  = p.value("connection_type", "lan");
    params.plate_index      = p.value("plate_index", 0);
    params.task_bed_leveling = p.value("bed_leveling", false);
    params.task_flow_cali    = p.value("flow_cali", false);
    params.task_vibration_cali = false;
    params.task_layer_inspect  = false;
    params.task_record_timelapse = false;
    params.task_timelapse_use_internal = false;
    params.task_use_ams        = p.value("use_ams", false);
    params.task_ext_change_assist = false;
    params.try_emmc_print      = false;

    auto flag = cancel_flag(key, capability);
    flag->store(false);
    auto on_status = [key, capability](int status, int code, std::string msg) {
        plugin_events::emit({"agent-print", key, capability, json{{"status", status}, {"code", code}, {"message", msg}}.dump()});
    };
    return guarded("start_local_print", [&] {
        return a->start_local_print(params, on_status, [flag]() { return flag->load(); });
    });
}

void agent_cancel_print(const std::string& key, const std::string& capability) { cancel_flag(key, capability)->store(true); }

}}} // namespace Slic3r::Mobile::Plugins
