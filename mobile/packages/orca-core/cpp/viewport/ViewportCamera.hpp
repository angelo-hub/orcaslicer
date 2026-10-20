#pragma once

#include "ViewportTypes.hpp"

namespace orca::viewport {

// Orbit camera, z up. Screen coordinates are in the units touch events arrive in
// (points on iOS, dp on Android), top-left origin.
class OrbitCamera {
public:
  OrbitCamera();

  // Frames the bounds, or the plate origin when they are empty.
  void fit(const Bounds& bounds);
  void orbitBy(float dx, float dy);
  void panBy(float dx, float dy);
  void zoomBy(float factor);

  float3 eye() const;
  float3 target() const { return target_; }
  float distance() const { return distance_; }

  float4x4 viewProjection(float width, float height) const;

  // The world-space ray under a screen point. False when the view has no size.
  bool screenToRay(float x, float y, float width, float height, float3& origin, float3& direction) const;

  // Where the ray under a screen point meets the plate plane (z = 0). False when the
  // view has no size or the ray is parallel to the plate, which would project the finger
  // to points miles away; the outs are untouched then.
  bool screenToPlateXY(float x, float y, float width, float height, float& outX, float& outY) const;

private:
  float3 target_;
  float yaw_;
  float pitch_;
  float distance_;
};

} // namespace orca::viewport
