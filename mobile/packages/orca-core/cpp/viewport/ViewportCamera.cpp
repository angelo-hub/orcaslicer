#include "ViewportCamera.hpp"

#include <algorithm>
#include <cmath>

namespace orca::viewport {

namespace {
constexpr float kPi = 3.14159265358979323846f;
}

OrbitCamera::OrbitCamera()
    // Camera in the -Y front quadrant, slightly to the right (+X), so bed models
    // authored with their front-facing labels on the -Y edge read correctly. Matches
    // the desktop's convention: eye = (sin·cos, cos·cos, sin) · distance, so
    // yaw ≈ π − 0.6 gives (sin > 0, cos < 0), front-right looking into +Y.
    : target_{0, 0, 0}, yaw_(kPi - 0.6f), pitch_(0.5f), distance_(400.f) {}

void OrbitCamera::fit(const Bounds& bounds) {
  target_ = bounds.valid ? bounds.center() : float3{0, 0, 0};
  const float radius = std::max(bounds.radius(), 20.f);
  distance_ = radius / std::sin(0.35f) * 1.15f;
}

void OrbitCamera::orbitBy(float dx, float dy) {
  yaw_ += dx * 0.01f;
  pitch_ = std::clamp(pitch_ + dy * 0.01f, -1.5f, 1.5f);
}

void OrbitCamera::panBy(float dx, float dy) {
  // Move the target in the camera's screen plane, scaled so a drag follows the finger.
  const float scale = distance_ * 0.0015f;
  const float3 forward = normalize(make_float3(std::sin(yaw_) * std::cos(pitch_), std::cos(yaw_) * std::cos(pitch_), std::sin(pitch_)));
  const float3 right = normalize(cross(forward, make_float3(0, 0, 1)));
  const float3 up = cross(right, forward);
  target_ = target_ - right * (dx * scale) + up * (dy * scale);
}

void OrbitCamera::zoomBy(float factor) {
  if (factor > 0) {
    distance_ = std::clamp(distance_ / factor, 5.f, 5000.f);
  }
}

float3 OrbitCamera::eye() const {
  return target_ + make_float3(std::sin(yaw_) * std::cos(pitch_), std::cos(yaw_) * std::cos(pitch_), std::sin(pitch_)) * distance_;
}

float4x4 OrbitCamera::viewProjection(float width, float height) const {
  const float4x4 view = lookAt(eye(), target_, make_float3(0, 0, 1));
  const float aspect = height > 0 ? width / height : 1.f;
  const float4x4 projection = perspective(0.7f, aspect, std::max(distance_ * 0.01f, 0.1f), distance_ * 10.f + 1000.f);
  return mul(projection, view);
}

bool OrbitCamera::screenToRay(float x, float y, float width, float height, float3& origin, float3& direction) const {
  if (width <= 0 || height <= 0) return false;
  // Screen → NDC ([-1, 1], y up in NDC against y down for touches).
  const float nx = x / width * 2.f - 1.f;
  const float ny = 1.f - y / height * 2.f;
  float4x4 invVP;
  if (!inverse(viewProjection(width, height), invVP)) return false;
  float4 nearP = mul(invVP, make_float4(nx, ny, 0.f, 1.f));
  float4 farP = mul(invVP, make_float4(nx, ny, 1.f, 1.f));
  if (nearP.w == 0.f || farP.w == 0.f) return false;
  const float3 n = xyz(nearP) * (1.f / nearP.w);
  const float3 f = xyz(farP) * (1.f / farP.w);
  origin = n;
  direction = normalize(f - n);
  return true;
}

bool OrbitCamera::screenToPlateXY(float x, float y, float width, float height, float& outX, float& outY) const {
  float3 origin;
  float3 direction;
  if (!screenToRay(x, y, width, height, origin, direction)) return false;
  // The ray meets z = 0 where origin.z + t * direction.z == 0.
  if (std::fabs(direction.z) < 1e-4f) return false;
  const float t = -origin.z / direction.z;
  if (t <= 0.f) return false;
  outX = origin.x + direction.x * t;
  outY = origin.y + direction.y * t;
  return true;
}

} // namespace orca::viewport
