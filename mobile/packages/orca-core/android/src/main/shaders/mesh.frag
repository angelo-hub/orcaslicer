#version 450
#extension GL_GOOGLE_include_directive : require
#include "common.glsl"

layout(location = 0) in vec3 inWorld;
layout(location = 0) out vec4 outColor;

void main() {
  // The screen-space derivatives span the triangle, so their cross product is its flat
  // normal. Its sign depends on the screen's handedness; a visible face of a closed mesh
  // faces the camera, so turn it that way.
  vec3 n = normalize(cross(dFdx(inWorld), dFdy(inWorld)));
  if (dot(n, u.eye.xyz - inWorld) < 0.0) n = -n;
  outColor = vec4(u.color.rgb * shadeFor(n), u.color.a);
}
