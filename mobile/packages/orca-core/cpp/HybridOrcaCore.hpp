#pragma once

#include "HybridOrcaCoreSpec.hpp"

namespace margelo::nitro::orca {

// The core's entry point: version, directories, option metadata, session creation, and
// the plugin host. Autolinked by nitro.json, so it needs the default constructor.
class HybridOrcaCore final : public HybridOrcaCoreSpec {
public:
  HybridOrcaCore() : HybridObject(TAG) {}

  std::string getVersion() override;
  std::string getUpstreamCommit() override;
  void initialize(const std::string& resourcesDir, const std::string& dataDir) override;
  std::string optionDefinitionsJson() override;
  std::shared_ptr<HybridOrcaSessionSpec> createSession() override;

  // Plugins. The façade is process-wide and serializes itself; every call that can enter
  // Python runs on Nitro's pool, never on the JS thread (see OrcaCore.nitro.ts).
  bool getPluginsSupported() override;
  std::shared_ptr<Promise<std::string>> pluginsInitialize(const std::string& pythonHome,
                                                          const std::string& cloudUserId) override;
  void pluginsSetCloudUser(const std::string& userId) override;
  void pluginsSetAppLanguage(const std::string& language) override;
  std::shared_ptr<Promise<std::string>> pluginsDiscover() override;
  std::string pluginList() override;
  std::shared_ptr<Promise<std::string>> pluginLoad(const std::string& key) override;
  std::shared_ptr<Promise<bool>> pluginUnload(const std::string& key) override;
  std::shared_ptr<Promise<std::string>> pluginRemove(const std::string& key) override;
  std::shared_ptr<Promise<std::string>> pluginSetCapabilityEnabled(const std::string& key, const std::string& capability,
                                                                   bool enabled) override;
  bool pluginPermissionGrant(const std::string& key, const std::string& category, const std::string& target,
                             bool granted) override;
  void setPluginEventListener(const std::function<void(const PluginEvent&)>& listener) override;
  void pluginAnswer(double requestId, const std::string& answer) override;
  std::shared_ptr<Promise<std::string>> pluginPageHtml(const std::string& key, const std::string& capability) override;
  std::shared_ptr<Promise<std::string>> pluginPageIcon(const std::string& key, const std::string& capability) override;
  std::shared_ptr<Promise<std::string>> pluginPageOpen(const std::string& key, const std::string& capability) override;
  void pluginPageClose(const std::string& key, const std::string& capability) override;
  std::shared_ptr<Promise<std::string>> pluginPageSend(const std::string& key, const std::string& capability,
                                                       const std::string& messageJson) override;
  std::string pluginCheckRefs(const std::string& refsJson) override;
  std::shared_ptr<Promise<std::string>> pluginRunScript(const std::string& key, const std::string& capability) override;
};

} // namespace margelo::nitro::orca
