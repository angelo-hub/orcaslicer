#pragma once

// The little linear algebra the viewport needs, with no platform or library dependency
// so the same code serves the Metal and Vulkan backends. Matrices are column-major, the
// layout Metal's float4x4 and GLSL's mat4 share, so a float4x4 is uploaded as is.

#include <cmath>

namespace orca::viewport {

struct float2 {
  float x = 0, y = 0;
};

struct float3 {
  float x = 0, y = 0, z = 0;
};

struct alignas(16) float4 {
  float x = 0, y = 0, z = 0, w = 0;
};

struct float4x4 {
  float4 columns[4];
};

inline float3 make_float3(float x, float y, float z) { return float3{x, y, z}; }
inline float4 make_float4(float x, float y, float z, float w) { return float4{x, y, z, w}; }
inline float4 make_float4(float3 v, float w) { return float4{v.x, v.y, v.z, w}; }
inline float3 xyz(float4 v) { return float3{v.x, v.y, v.z}; }

inline float3 operator+(float3 a, float3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline float3 operator-(float3 a, float3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline float3 operator-(float3 a) { return {-a.x, -a.y, -a.z}; }
inline float3 operator*(float3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float3 operator*(float s, float3 a) { return a * s; }
inline float3& operator+=(float3& a, float3 b) { a = a + b; return a; }
inline float3& operator-=(float3& a, float3 b) { a = a - b; return a; }

inline float dot(float3 a, float3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float3 cross(float3 a, float3 b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float length_squared(float3 a) { return dot(a, a); }
inline float length(float3 a) { return std::sqrt(length_squared(a)); }
inline float3 normalize(float3 a) {
  const float len = length(a);
  return len > 0.f ? a * (1.f / len) : a;
}
inline float3 vmin(float3 a, float3 b) { return {std::fmin(a.x, b.x), std::fmin(a.y, b.y), std::fmin(a.z, b.z)}; }
inline float3 vmax(float3 a, float3 b) { return {std::fmax(a.x, b.x), std::fmax(a.y, b.y), std::fmax(a.z, b.z)}; }

// M * v, with M's columns scaled by v's components.
inline float4 mul(const float4x4& m, float4 v) {
  const float4& c0 = m.columns[0];
  const float4& c1 = m.columns[1];
  const float4& c2 = m.columns[2];
  const float4& c3 = m.columns[3];
  return {c0.x * v.x + c1.x * v.y + c2.x * v.z + c3.x * v.w, c0.y * v.x + c1.y * v.y + c2.y * v.z + c3.y * v.w,
          c0.z * v.x + c1.z * v.y + c2.z * v.z + c3.z * v.w, c0.w * v.x + c1.w * v.y + c2.w * v.z + c3.w * v.w};
}

inline float4x4 mul(const float4x4& a, const float4x4& b) {
  float4x4 out;
  for (int i = 0; i < 4; ++i) out.columns[i] = mul(a, b.columns[i]);
  return out;
}

inline float4x4 identity() {
  float4x4 m;
  m.columns[0] = {1, 0, 0, 0};
  m.columns[1] = {0, 1, 0, 0};
  m.columns[2] = {0, 0, 1, 0};
  m.columns[3] = {0, 0, 0, 1};
  return m;
}

// Right-handed perspective with a [0, 1] depth range, as Metal and Vulkan expect.
inline float4x4 perspective(float fovyRadians, float aspect, float nearZ, float farZ) {
  const float ys = 1.f / std::tan(fovyRadians * 0.5f);
  const float xs = ys / aspect;
  const float zs = farZ / (nearZ - farZ);
  float4x4 m;
  m.columns[0] = {xs, 0, 0, 0};
  m.columns[1] = {0, ys, 0, 0};
  m.columns[2] = {0, 0, zs, -1};
  m.columns[3] = {0, 0, nearZ * zs, 0};
  return m;
}

inline float4x4 lookAt(float3 eye, float3 target, float3 up) {
  const float3 z = normalize(eye - target);
  const float3 x = normalize(cross(up, z));
  const float3 y = cross(z, x);
  float4x4 m;
  m.columns[0] = {x.x, y.x, z.x, 0};
  m.columns[1] = {x.y, y.y, z.y, 0};
  m.columns[2] = {x.z, y.z, z.z, 0};
  m.columns[3] = {-dot(x, eye), -dot(y, eye), -dot(z, eye), 1};
  return m;
}

// General inverse by cofactors. The element order does not matter as long as it is
// consistent: the inverse of the transpose is the transpose of the inverse. Returns
// false, leaving `out` untouched, for a singular matrix.
inline bool inverse(const float4x4& in, float4x4& out) {
  const float* m = &in.columns[0].x;
  float inv[16];
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const float det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det == 0.f) return false;
  const float invDet = 1.f / det;
  float* o = &out.columns[0].x;
  for (int i = 0; i < 16; ++i) o[i] = inv[i] * invDet;
  return true;
}

} // namespace orca::viewport
