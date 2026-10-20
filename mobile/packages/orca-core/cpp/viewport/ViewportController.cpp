#include "ViewportController.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace orca::viewport {

namespace {
constexpr float kPi = 3.14159265358979323846f;
// Stands in for the view's size before the platform reported one, so the drag mappings
// stay finite.
constexpr float kFallbackViewSize = 400.f;

float4 colorOf(const float* c) { return make_float4(c[0], c[1], c[2], c[3]); }
} // namespace

ViewportController::ViewportController(SessionAccess access, RedrawRequest redraw)
    : access_(std::move(access)), redraw_(std::move(redraw)) {}

void ViewportController::setMinLayer(long layer) {
  filter_.minLayer = layer;
  updateRanges();
}

void ViewportController::setMaxLayer(long layer) {
  filter_.maxLayer = layer;
  updateRanges();
}

void ViewportController::setMaxTime(float seconds) {
  filter_.maxTime = seconds;
  updateRanges();
}

void ViewportController::setShowTravels(bool show) {
  options_.showTravels = show;
  rebuildToolpath();
}

void ViewportController::setShowRetractions(bool show) {
  options_.showRetractions = show;
  rebuildToolpath();
}

void ViewportController::setShowWipes(bool show) {
  options_.showWipes = show;
  rebuildToolpath();
}

void ViewportController::setColorMode(ColorMode mode) {
  options_.colorMode = mode;
  rebuildToolpath();
}

void ViewportController::setSelectedId(uint64_t id) {
  if (selectedId_ == id) return;
  selectedId_ = id;
  requestRedraw();
}

void ViewportController::setViewSize(float width, float height) {
  viewWidth_ = width;
  viewHeight_ = height;
}

void ViewportController::reload() {
  SceneGeometry scene;
  const bool found = access_(sessionId_, [&](Slic3r::Mobile::Session& session) { scene = buildScene(session, mode_); });
  if (!found) {
    // Unknown session or a slice in progress: keep what is on screen.
    return;
  }
  const bool hadBounds = scene_.bounds.valid;
  scene_ = std::move(scene);
  ++sceneRevision_;
  rebuildToolpath();
  if (!hadBounds) {
    fit();
  }
  requestRedraw();
}

void ViewportController::rebuildToolpath() {
  toolpath_ = mode_ == Mode::Preview ? buildToolpath(scene_.preview, options_) : Toolpath{};
  ++toolpathRevision_;
  updateRanges();
}

void ViewportController::updateRanges() {
  ranges_ = filterToolpath(scene_.preview, toolpath_, filter_);
  requestRedraw();
}

void ViewportController::requestRedraw() {
  if (redraw_) redraw_();
}

void ViewportController::fit() {
  camera_.fit(scene_.bounds);
  requestRedraw();
}

void ViewportController::orbitBy(float dx, float dy) {
  camera_.orbitBy(dx, dy);
  requestRedraw();
}

void ViewportController::panBy(float dx, float dy) {
  camera_.panBy(dx, dy);
  requestRedraw();
}

void ViewportController::zoomBy(float factor) {
  camera_.zoomBy(factor);
  requestRedraw();
}

bool ViewportController::screenToRay(float x, float y, float3& origin, float3& direction) const {
  return camera_.screenToRay(x, y, viewWidth_, viewHeight_, origin, direction);
}

bool ViewportController::screenToPlateXY(float x, float y, float& outX, float& outY) const {
  return camera_.screenToPlateXY(x, y, viewWidth_, viewHeight_, outX, outY);
}

uint64_t ViewportController::pickObject(float x, float y) const {
  float3 origin;
  float3 direction;
  if (!screenToRay(x, y, origin, direction)) return 0;
  uint64_t hitId = 0;
  access_(sessionId_, [&](Slic3r::Mobile::Session& session) {
    const Slic3r::Mobile::Session::PickHit hit =
        session.pick_at({double(origin.x), double(origin.y), double(origin.z)}, {double(direction.x), double(direction.y), double(direction.z)});
    hitId = static_cast<uint64_t>(hit.id);
  });
  return hitId;
}

void ViewportController::setObjectTool(ObjectTool tool) {
  if (dragObjectId_ == 0) {
    dragTool_ = tool;
  }
}

bool ViewportController::beginDrag(uint64_t objectId, float x, float y) {
  if (objectId == 0) return false;
  float anchorX = 0, anchorY = 0;
  if (!screenToPlateXY(x, y, anchorX, anchorY)) return false;

  bool found = false;
  float3 initialPos{0, 0, 0};
  float3 initialRot{0, 0, 0};
  float3 initialSca{1, 1, 1};
  access_(sessionId_, [&](Slic3r::Mobile::Session& session) {
    for (const Slic3r::Mobile::ObjectInfo& obj : session.objects()) {
      if (obj.id != objectId) continue;
      initialPos = make_float3(float(obj.position[0]), float(obj.position[1]), float(obj.position[2]));
      initialRot = make_float3(float(obj.rotation[0]), float(obj.rotation[1]), float(obj.rotation[2]));
      initialSca = make_float3(float(obj.scale[0]), float(obj.scale[1]), float(obj.scale[2]));
      found = true;
      break;
    }
  });
  if (!found) return false;

  dragObjectId_ = objectId;
  dragInitialPosition_ = initialPos;
  dragInitialRotation_ = initialRot;
  dragInitialScale_ = initialSca;
  dragAnchorXY_ = float2{anchorX, anchorY};
  dragStartScreen_ = float2{x, y};
  dragOffset_ = float3{0, 0, 0};
  dragRotationZ_ = 0.f;
  dragScaleFactor_ = 1.f;
  requestRedraw();
  return true;
}

void ViewportController::dragTo(float x, float y) {
  if (dragObjectId_ == 0) return;
  const float viewWidth = viewWidth_ > 0 ? viewWidth_ : kFallbackViewSize;
  const float viewHeight = viewHeight_ > 0 ? viewHeight_ : kFallbackViewSize;
  switch (dragTool_) {
    case ObjectTool::Rotate: {
      // Horizontal finger travel sets the angle: the view's width is π radians, fine
      // enough for small adjustments and coarse enough to flip 180°.
      const float dx = x - dragStartScreen_.x;
      dragRotationZ_ = dx / viewWidth * kPi;
      break;
    }
    case ObjectTool::Scale: {
      // Vertical finger travel sets a uniform scale, up grows and down shrinks, ±1 octave
      // across half the view, clamped so a stray drag cannot zero the mesh.
      const float dy = dragStartScreen_.y - y;
      const float exponent = dy / (viewHeight * 0.5f);
      dragScaleFactor_ = std::clamp(std::pow(2.f, exponent), 0.1f, 10.f);
      break;
    }
    case ObjectTool::Move:
    default: {
      // The plate point that was under the finger at the start follows the finger.
      float plateX = 0, plateY = 0;
      if (!screenToPlateXY(x, y, plateX, plateY)) return;
      dragOffset_ = make_float3(plateX - dragAnchorXY_.x, plateY - dragAnchorXY_.y, 0.f);
      break;
    }
  }
  requestRedraw();
}

void ViewportController::endDrag() {
  if (dragObjectId_ == 0) return;
  const Slic3r::Mobile::Vec3 position = {
      double(dragInitialPosition_.x + dragOffset_.x),
      double(dragInitialPosition_.y + dragOffset_.y),
      double(dragInitialPosition_.z + dragOffset_.z),
  };
  const Slic3r::Mobile::Vec3 rotation = {
      double(dragInitialRotation_.x),
      double(dragInitialRotation_.y),
      double(dragInitialRotation_.z + dragRotationZ_),
  };
  const Slic3r::Mobile::Vec3 scale = {
      double(dragInitialScale_.x * dragScaleFactor_),
      double(dragInitialScale_.y * dragScaleFactor_),
      double(dragInitialScale_.z * dragScaleFactor_),
  };
  const uint64_t objectId = dragObjectId_;
  const ObjectTool tool = dragTool_;
  access_(sessionId_, [&](Slic3r::Mobile::Session& session) {
    session.set_transform(static_cast<unsigned long>(objectId), position, rotation, scale);
    const char* label = tool == ObjectTool::Rotate ? "Rotate" : tool == ObjectTool::Scale ? "Scale" : "Move object";
    session.take_snapshot(label);
  });
  dragObjectId_ = 0;
  dragOffset_ = float3{0, 0, 0};
  dragRotationZ_ = 0.f;
  dragScaleFactor_ = 1.f;
  reload();
}

Uniforms ViewportController::frameUniforms(float width, float height) const {
  Uniforms u;
  u.mvp = camera_.viewProjection(width, height);
  u.lightDir = make_float4(0.3f, -0.5f, 0.8f, 0);
  u.eye = make_float4(camera_.eye(), 1);
  u.color = make_float4(1, 1, 1, 1);
  u.modelOffset = make_float4(0, 0, 0, 0);
  u.dragAnchor = make_float4(0, 0, 0, 0);
  u.dragParams = make_float4(0, 1, 0, 0); // no rotation, identity scale
  return u;
}

Uniforms ViewportController::bedModelUniforms(const Uniforms& frame) const {
  Uniforms u = frame;
  u.color = colorOf(kBedModelColor);
  return u;
}

Uniforms ViewportController::meshUniforms(const Uniforms& frame, const MeshRange& range) const {
  Uniforms u = frame;
  u.color = colorOf(selectedId_ != 0 && range.id == selectedId_ ? kSelectedObjectColor : kObjectColor);
  if (dragObjectId_ != 0 && range.id == dragObjectId_) {
    // The dragged object picks up the frame's rotation and scale around its instance
    // origin; Move leaves those at (0, 1) so only the offset acts.
    u.modelOffset = make_float4(dragOffset_, 0);
    u.dragAnchor = make_float4(dragInitialPosition_, 0);
    u.dragParams = make_float4(dragRotationZ_, dragScaleFactor_, 0, 0);
  }
  return u;
}

} // namespace orca::viewport
