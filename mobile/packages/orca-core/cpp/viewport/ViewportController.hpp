#pragma once

// The platform-neutral half of the viewport. It owns the props the Nitro view receives,
// the camera, the geometry read from the session and the drag in flight, and tells the
// platform backend when to redraw. A backend (Metal on iOS, Vulkan on Android) keeps
// GPU copies of `scene()` and `toolpath()`, refreshed when their revision changes, and
// draws them with the uniforms this class computes, so every platform renders the same
// picture and the shaders are the only code written twice.
//
// Not thread-safe: the platform calls it from its UI thread, where gestures, prop
// updates and draws already serialize.

#include "ViewportCamera.hpp"
#include "ViewportScene.hpp"

#include <cstdint>
#include <functional>

namespace orca::viewport {

class ViewportController {
public:
  // Runs fn with the session of that id locked, or returns false when the id is
  // unknown or a long operation holds the session (SessionRegistry::with).
  using SessionAccess = std::function<bool(uint64_t sessionId, const std::function<void(Slic3r::Mobile::Session&)>&)>;
  using RedrawRequest = std::function<void()>;

  ViewportController(SessionAccess access, RedrawRequest redraw);

  // Props. Changing the session or the mode takes effect on the next reload(), the
  // others as soon as they are set.
  void setSessionId(uint64_t id) { sessionId_ = id; }
  uint64_t sessionId() const { return sessionId_; }
  void setMode(Mode mode) { mode_ = mode; }
  Mode mode() const { return mode_; }
  void setMinLayer(long layer);
  long minLayer() const { return filter_.minLayer; }
  void setMaxLayer(long layer);
  long maxLayer() const { return filter_.maxLayer; }
  void setMaxTime(float seconds);
  float maxTime() const { return filter_.maxTime; }
  void setShowTravels(bool show);
  bool showTravels() const { return options_.showTravels; }
  void setShowRetractions(bool show);
  bool showRetractions() const { return options_.showRetractions; }
  void setShowWipes(bool show);
  bool showWipes() const { return options_.showWipes; }
  void setColorMode(ColorMode mode);
  ColorMode colorMode() const { return options_.colorMode; }
  // Highlights this object; 0 clears the selection.
  void setSelectedId(uint64_t id);
  uint64_t selectedId() const { return selectedId_; }

  // The view's size in the units touch coordinates arrive in. Rays and the drag
  // mappings use it; the backend passes its own drawable size to frameUniforms().
  void setViewSize(float width, float height);

  // Re-reads bed, objects and toolpath from the session and redraws. Keeps what is on
  // screen when the session is unknown or busy.
  void reload();
  // Frames the bed and everything on it.
  void fit();
  void orbitBy(float dx, float dy);
  void panBy(float dx, float dy);
  void zoomBy(float factor);

  bool screenToRay(float x, float y, float3& origin, float3& direction) const;
  bool screenToPlateXY(float x, float y, float& outX, float& outY) const;
  // The topmost object under the screen point, 0 on a miss. Runs on the calling thread
  // against the session, so it fails to 0 while a long operation holds it.
  uint64_t pickObject(float x, float y) const;

  // What a 1-finger drag on the selected object does. Ignored while a drag is in flight
  // so the gesture keeps its tool until release.
  void setObjectTool(ObjectTool tool);
  ObjectTool objectTool() const { return dragTool_; }
  // Begins a drag: captures the object's transform and the plate point under the finger.
  // False when the object no longer exists or the touch misses the plate.
  bool beginDrag(uint64_t objectId, float x, float y);
  // Moves, rotates or scales the dragged object after the finger; the result reaches the
  // GPU through meshUniforms(), without a mesh rebuild. No-op without a drag.
  void dragTo(float x, float y);
  // Commits the drag to the session with one undo snapshot and reloads. No-op without a drag.
  void endDrag();
  bool isDragging() const { return dragObjectId_ != 0; }

  // Backend interface. The revisions change whenever the vectors do.
  const SceneGeometry& scene() const { return scene_; }
  uint32_t sceneRevision() const { return sceneRevision_; }
  const Toolpath& toolpath() const { return toolpath_; }
  uint32_t toolpathRevision() const { return toolpathRevision_; }
  const ToolpathRanges& ranges() const { return ranges_; }
  // The frame's camera and light with an identity object transform; the size is the
  // drawable's, for the aspect.
  Uniforms frameUniforms(float width, float height) const;
  // The frame uniforms with the bed model's colour.
  Uniforms bedModelUniforms(const Uniforms& frame) const;
  // The frame uniforms with one object's colour (selection tint included) and, for the
  // object being dragged, the drag transform.
  Uniforms meshUniforms(const Uniforms& frame, const MeshRange& range) const;

private:
  void rebuildToolpath();
  void updateRanges();
  void requestRedraw();

  SessionAccess access_;
  RedrawRequest redraw_;

  uint64_t sessionId_ = 0;
  Mode mode_ = Mode::Scene;
  ToolpathOptions options_;
  ToolpathFilter filter_;
  uint64_t selectedId_ = 0;
  float viewWidth_ = 0.f;
  float viewHeight_ = 0.f;

  OrbitCamera camera_;
  SceneGeometry scene_;
  uint32_t sceneRevision_ = 0;
  Toolpath toolpath_;
  uint32_t toolpathRevision_ = 0;
  ToolpathRanges ranges_;

  // Drag state. Non-zero id while a drag is in flight; every drag frame only updates
  // the offset, rotation or scale the shader applies to the dragged object's range.
  uint64_t dragObjectId_ = 0;
  ObjectTool dragTool_ = ObjectTool::Move;
  float3 dragInitialPosition_;
  float3 dragInitialRotation_;
  float3 dragInitialScale_{1, 1, 1};
  float2 dragAnchorXY_;    // plate point under the finger at the start, for move deltas
  float2 dragStartScreen_; // the finger's initial screen position, for rotate and scale
  float3 dragOffset_;      // world-space translation applied by Move
  float dragRotationZ_ = 0.f; // radians added around Z by Rotate
  float dragScaleFactor_ = 1.f; // uniform multiplier applied by Scale
};

} // namespace orca::viewport
