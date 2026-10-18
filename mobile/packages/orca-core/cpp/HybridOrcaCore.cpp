#include "HybridOrcaCore.hpp"

#include "HybridOrcaSession.hpp"

#include <OrcaCore/OrcaMobile.hpp>
#include <OrcaCore/Plugins.hpp>
#include <OrcaCore/Session.hpp>

namespace margelo::nitro::orca {

namespace Plugins = Slic3r::Mobile::Plugins;

std::string HybridOrcaCore::getVersion() {
  return Slic3r::Mobile::core_version();
}

std::string HybridOrcaCore::getUpstreamCommit() {
  return Slic3r::Mobile::upstream_commit();
}

void HybridOrcaCore::initialize(const std::string& resourcesDir, const std::string& dataDir) {
  Slic3r::Mobile::set_directories(resourcesDir, dataDir);
}

std::string HybridOrcaCore::optionDefinitionsJson() {
  return Slic3r::Mobile::Session::option_definitions_json();
}

std::shared_ptr<HybridOrcaSessionSpec> HybridOrcaCore::createSession() {
  return std::make_shared<HybridOrcaSession>();
}

// Plugins

bool HybridOrcaCore::getPluginsSupported() {
  return Plugins::supported();
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginsInitialize(const std::string& pythonHome,
                                                                        const std::string& cloudUserId) {
  return Promise<std::string>::async([pythonHome, cloudUserId]() { return Plugins::initialize(pythonHome, cloudUserId); });
}

void HybridOrcaCore::pluginsSetCloudUser(const std::string& userId) {
  Plugins::set_cloud_user(userId);
}

void HybridOrcaCore::pluginsSetAppLanguage(const std::string& language) {
  Plugins::set_app_language(language);
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginsDiscover() {
  return Promise<std::string>::async([]() { return Plugins::discover(); });
}

std::string HybridOrcaCore::pluginList() {
  return Plugins::list_json();
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginLoad(const std::string& key) {
  return Promise<std::string>::async([key]() { return Plugins::load(key); });
}

std::shared_ptr<Promise<bool>> HybridOrcaCore::pluginUnload(const std::string& key) {
  return Promise<bool>::async([key]() { return Plugins::unload(key); });
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginRemove(const std::string& key) {
  return Promise<std::string>::async([key]() { return Plugins::remove(key); });
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginSetCapabilityEnabled(const std::string& key,
                                                                                 const std::string& capability,
                                                                                 bool enabled) {
  return Promise<std::string>::async(
      [key, capability, enabled]() { return Plugins::set_capability_enabled(key, capability, enabled); });
}

bool HybridOrcaCore::pluginPermissionGrant(const std::string& key, const std::string& category,
                                           const std::string& target, bool granted) {
  return Plugins::permission_grant(key, category, target, granted);
}

void HybridOrcaCore::setPluginEventListener(const std::function<void(const PluginEvent&)>& listener) {
  // A void-returning JS callback is dispatched to the JS thread by Nitro, so the host may
  // call it from whichever thread a plugin runs on.
  Plugins::set_event_sink([listener](const Slic3r::Mobile::PluginEvent& e) {
    listener(PluginEvent(e.kind, e.plugin_key, e.capability, e.payload_json, static_cast<double>(e.request_id)));
  });
}

void HybridOrcaCore::pluginAnswer(double requestId, const std::string& answer) {
  Plugins::answer(static_cast<long>(requestId), answer);
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginPageHtml(const std::string& key,
                                                                     const std::string& capability) {
  return Promise<std::string>::async([key, capability]() {
    std::string error;
    std::string html = Plugins::page_html(key, capability, error);
    if (!error.empty()) throw std::runtime_error(error);
    return html;
  });
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginPageIcon(const std::string& key,
                                                                     const std::string& capability) {
  return Promise<std::string>::async([key, capability]() { return Plugins::page_icon(key, capability); });
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginPageOpen(const std::string& key,
                                                                     const std::string& capability) {
  return Promise<std::string>::async([key, capability]() { return Plugins::page_open(key, capability); });
}

void HybridOrcaCore::pluginPageClose(const std::string& key, const std::string& capability) {
  Plugins::page_close(key, capability);
}

std::shared_ptr<Promise<std::string>> HybridOrcaCore::pluginPageSend(const std::string& key,
                                                                     const std::string& capability,
                                                                     const std::string& messageJson) {
  return Promise<std::string>::async(
      [key, capability, messageJson]() { return Plugins::page_send(key, capability, messageJson); });
}

} // namespace margelo::nitro::orca
