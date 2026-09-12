#pragma once

#include "HybridOrcaSessionSpec.hpp"

#include <OrcaCore/Session.hpp>

#include <cstdint>
#include <mutex>

namespace margelo::nitro::orca {

// One project. Wraps Slic3r::Mobile::Session; see src/mobile/core/Session.hpp.
//
// The façade is not thread-safe, so a mutex serializes every call. Promise-returning
// methods run on Nitro's thread pool holding that mutex; synchronous methods take it
// with try_lock and throw when a long operation holds it, which JS sees as a rejected
// call rather than a frozen UI thread. cancel() never takes the mutex.
class HybridOrcaSession final : public HybridOrcaSessionSpec {
public:
  HybridOrcaSession();
  ~HybridOrcaSession() override;

  // Properties
  double getId() override;
  bool getIsSliced() override;
  bool getIsBusy() override;

  // Presets
  std::shared_ptr<Promise<std::string>> loadPresets() override;
  std::vector<PresetInfo> presets(PresetKind kind) override;
  std::string selectedPreset(PresetKind kind) override;
  bool selectPreset(PresetKind kind, const std::string& name) override;
  bool selectFilament(double extruder, const std::string& name) override;
  BedInfo bed() override;

  // Options
  std::string option(const std::string& key) override;
  bool setOption(const std::string& key, const std::string& value) override;
  std::vector<std::string> modifiedOptions(PresetKind kind) override;
  void discardModifiedOptions(PresetKind kind) override;

  // Model
  std::shared_ptr<Promise<std::vector<ObjectInfo>>> importModel(const std::string& path) override;
  std::vector<ObjectInfo> objects() override;
  bool removeObject(double id) override;
  bool setTransform(double id, const Vec3& position, const Vec3& rotation, const Vec3& scale) override;
  void clear() override;
  std::shared_ptr<Promise<void>> arrange() override;

  // Slicing
  std::shared_ptr<Promise<SliceResult>> slice(const std::function<void(const Progress&)>& onProgress) override;
  void cancel() override;
  std::shared_ptr<Promise<std::string>> exportGCode(const std::string& path) override;
  SliceStatistics statistics() override;

private:
  // Locks for a synchronous call; throws if a long operation holds the session.
  std::unique_lock<std::mutex> lockNow();

  Slic3r::Mobile::Session _session;
  std::mutex _mutex;
  uint64_t _id = 0;
};

} // namespace margelo::nitro::orca
