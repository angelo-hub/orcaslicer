#include "HybridOrcaSession.hpp"

#include "SessionRegistry.hpp"

#include <NitroModules/Promise.hpp>

#include <stdexcept>
#include <utility>

namespace margelo::nitro::orca {

namespace {

using Slic3r::Mobile::Session;

Slic3r::Mobile::PresetKind toCore(PresetKind kind) {
  switch (kind) {
    case PresetKind::PRINTER:
      return Slic3r::Mobile::PresetKind::Printer;
    case PresetKind::FILAMENT:
      return Slic3r::Mobile::PresetKind::Filament;
    default:
      return Slic3r::Mobile::PresetKind::Process;
  }
}

Vec3 toJS(const Slic3r::Mobile::Vec3& v) {
  return Vec3(v[0], v[1], v[2]);
}

Slic3r::Mobile::Vec3 toCore(const Vec3& v) {
  return {v.x, v.y, v.z};
}

PresetInfo toJS(const Slic3r::Mobile::PresetInfo& p) {
  return PresetInfo(p.name, p.vendor, p.is_system, p.is_user, p.is_visible, p.is_compatible, p.is_selected);
}

ObjectInfo toJS(const Slic3r::Mobile::ObjectInfo& o) {
  return ObjectInfo(static_cast<double>(o.id), o.name, toJS(o.position), toJS(o.rotation), toJS(o.scale), toJS(o.size),
                    static_cast<double>(o.triangles));
}

std::vector<ObjectInfo> toJS(const std::vector<Slic3r::Mobile::ObjectInfo>& objects) {
  std::vector<ObjectInfo> out;
  out.reserve(objects.size());
  for (const auto& o : objects) {
    out.push_back(toJS(o));
  }
  return out;
}

std::vector<PresetInfo> toJS(const std::vector<Slic3r::Mobile::PresetInfo>& presets) {
  std::vector<PresetInfo> out;
  out.reserve(presets.size());
  for (const auto& p : presets) {
    out.push_back(toJS(p));
  }
  return out;
}

SliceOutcome toJS(Slic3r::Mobile::SliceOutcome outcome) {
  switch (outcome) {
    case Slic3r::Mobile::SliceOutcome::Finished:
      return SliceOutcome::FINISHED;
    case Slic3r::Mobile::SliceOutcome::Cancelled:
      return SliceOutcome::CANCELLED;
    default:
      return SliceOutcome::FAILED;
  }
}

SliceResult toJS(const Slic3r::Mobile::SliceResult& r) {
  std::vector<SliceWarning> warnings;
  warnings.reserve(r.warnings.size());
  for (const auto& w : r.warnings) {
    warnings.push_back(SliceWarning(w.text, w.critical));
  }
  return SliceResult(toJS(r.outcome), r.error, std::move(warnings));
}

} // namespace

HybridOrcaSession::HybridOrcaSession() : HybridObject(TAG) {
  _id = SessionRegistry::add(&_session, &_mutex);
}

HybridOrcaSession::~HybridOrcaSession() {
  // Unregister first, then wait for any reader or long operation before the members die.
  SessionRegistry::remove(_id);
  std::lock_guard<std::mutex> lock(_mutex);
}

double HybridOrcaSession::getId() {
  return static_cast<double>(_id);
}

std::unique_lock<std::mutex> HybridOrcaSession::lockNow() {
  std::unique_lock<std::mutex> lock(_mutex, std::try_to_lock);
  if (!lock.owns_lock()) {
    throw std::runtime_error("OrcaSession is busy; wait for the pending operation or cancel it");
  }
  return lock;
}

bool HybridOrcaSession::getIsSliced() {
  auto lock = lockNow();
  return _session.is_sliced();
}

bool HybridOrcaSession::getIsBusy() {
  std::unique_lock<std::mutex> lock(_mutex, std::try_to_lock);
  return !lock.owns_lock();
}

std::shared_ptr<Promise<std::string>> HybridOrcaSession::loadPresets() {
  return Promise<std::string>::async([this]() -> std::string {
    std::lock_guard<std::mutex> lock(_mutex);
    return _session.load_presets();
  });
}

std::vector<PresetInfo> HybridOrcaSession::presets(PresetKind kind) {
  auto lock = lockNow();
  return toJS(_session.presets(toCore(kind)));
}

std::string HybridOrcaSession::selectedPreset(PresetKind kind) {
  auto lock = lockNow();
  return _session.selected_preset(toCore(kind));
}

bool HybridOrcaSession::selectPreset(PresetKind kind, const std::string& name) {
  auto lock = lockNow();
  return _session.select_preset(toCore(kind), name);
}

bool HybridOrcaSession::selectFilament(double extruder, const std::string& name) {
  auto lock = lockNow();
  if (extruder < 0) {
    return false;
  }
  return _session.select_filament(static_cast<size_t>(extruder), name);
}

BedInfo HybridOrcaSession::bed() {
  auto lock = lockNow();
  const Slic3r::Mobile::BedInfo bed = _session.bed();
  std::vector<Vec2> shape;
  shape.reserve(bed.shape.size());
  for (const auto& p : bed.shape) {
    shape.push_back(Vec2(p[0], p[1]));
  }
  return BedInfo(std::move(shape), bed.height);
}

std::string HybridOrcaSession::option(const std::string& key) {
  auto lock = lockNow();
  return _session.option(key);
}

bool HybridOrcaSession::setOption(const std::string& key, const std::string& value) {
  auto lock = lockNow();
  return _session.set_option(key, value);
}

std::vector<std::string> HybridOrcaSession::modifiedOptions(PresetKind kind) {
  auto lock = lockNow();
  return _session.modified_options(toCore(kind));
}

void HybridOrcaSession::discardModifiedOptions(PresetKind kind) {
  auto lock = lockNow();
  _session.discard_modified_options(toCore(kind));
}

std::shared_ptr<Promise<std::vector<ObjectInfo>>> HybridOrcaSession::importModel(const std::string& path) {
  return Promise<std::vector<ObjectInfo>>::async([this, path]() -> std::vector<ObjectInfo> {
    std::lock_guard<std::mutex> lock(_mutex);
    return toJS(_session.import(path));
  });
}

std::vector<ObjectInfo> HybridOrcaSession::objects() {
  auto lock = lockNow();
  return toJS(_session.objects());
}

bool HybridOrcaSession::removeObject(double id) {
  auto lock = lockNow();
  return _session.remove_object(static_cast<unsigned long>(id));
}

bool HybridOrcaSession::setTransform(double id, const Vec3& position, const Vec3& rotation, const Vec3& scale) {
  auto lock = lockNow();
  return _session.set_transform(static_cast<unsigned long>(id), toCore(position), toCore(rotation), toCore(scale));
}

void HybridOrcaSession::clear() {
  auto lock = lockNow();
  _session.clear();
}

std::shared_ptr<Promise<void>> HybridOrcaSession::arrange() {
  return Promise<void>::async([this]() {
    std::lock_guard<std::mutex> lock(_mutex);
    _session.arrange();
  });
}

std::shared_ptr<Promise<SliceResult>> HybridOrcaSession::slice(const std::function<void(const Progress&)>& onProgress) {
  // A void-returning JS callback is dispatched to the JS thread by Nitro, so it is safe
  // to call from the pool thread the slice runs on.
  return Promise<SliceResult>::async([this, onProgress]() -> SliceResult {
    std::lock_guard<std::mutex> lock(_mutex);
    return toJS(_session.slice([&onProgress](const Slic3r::Mobile::Progress& p) {
      onProgress(Progress(static_cast<double>(p.percent), p.message));
    }));
  });
}

void HybridOrcaSession::cancel() {
  _session.cancel();
}

std::shared_ptr<Promise<std::string>> HybridOrcaSession::exportGCode(const std::string& path) {
  return Promise<std::string>::async([this, path]() -> std::string {
    std::lock_guard<std::mutex> lock(_mutex);
    return _session.export_gcode(path);
  });
}

SliceStatistics HybridOrcaSession::statistics() {
  auto lock = lockNow();
  const Slic3r::Mobile::SliceStatistics s = _session.statistics();
  return SliceStatistics(s.print_time_s, s.filament_mm3, s.filament_g, s.filament_cost, static_cast<double>(s.layer_count));
}

} // namespace margelo::nitro::orca
