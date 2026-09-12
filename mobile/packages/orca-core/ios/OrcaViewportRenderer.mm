#import "OrcaViewportRenderer.h"

#include "SessionRegistry.hpp"

#import <simd/simd.h>

#include <algorithm>
#include <cmath>
#include <vector>

// The shader is compiled at runtime so the pod needs no metallib packaging.
static const char* const kShaderSource = R"metal(
#include <metal_stdlib>
using namespace metal;

struct VertexIn {
  packed_float3 position;
  packed_float3 normal;
  packed_float4 color;
};

struct Uniforms {
  float4x4 mvp;
  float4 lightDir;
  float4 params; // x: 1 for lit triangles, 0 for lines
};

struct VertexOut {
  float4 position [[position]];
  float4 color;
};

vertex VertexOut orca_vertex(const device VertexIn* vertices [[buffer(0)]],
                             constant Uniforms& u [[buffer(1)]],
                             uint vid [[vertex_id]]) {
  VertexIn v = vertices[vid];
  VertexOut out;
  out.position = u.mvp * float4(float3(v.position), 1.0);
  float shade = 1.0;
  if (u.params.x > 0.5) {
    float3 n = normalize(float3(v.normal));
    shade = 0.35 + 0.65 * max(dot(n, normalize(u.lightDir.xyz)), 0.0);
  }
  float4 c = float4(v.color);
  out.color = float4(c.rgb * shade, c.a);
  return out;
}

fragment float4 orca_fragment(VertexOut in [[stage_in]]) {
  return in.color;
}
)metal";

namespace {

struct Vertex {
  float position[3];
  float normal[3];
  float color[4];
};

struct Uniforms {
  simd_float4x4 mvp;
  simd_float4 lightDir;
  simd_float4 params;
};

struct Bounds {
  simd_float3 min{1e30f, 1e30f, 1e30f};
  simd_float3 max{-1e30f, -1e30f, -1e30f};
  bool valid = false;
  void add(simd_float3 p) {
    min = simd_min(min, p);
    max = simd_max(max, p);
    valid = true;
  }
  simd_float3 center() const { return (min + max) * 0.5f; }
  float radius() const { return valid ? simd_length(max - min) * 0.5f : 100.f; }
};

simd_float4x4 perspective(float fovyRadians, float aspect, float nearZ, float farZ) {
  const float ys = 1.f / tanf(fovyRadians * 0.5f);
  const float xs = ys / aspect;
  const float zs = farZ / (nearZ - farZ);
  return simd_matrix(simd_make_float4(xs, 0, 0, 0), simd_make_float4(0, ys, 0, 0), simd_make_float4(0, 0, zs, -1),
                     simd_make_float4(0, 0, nearZ * zs, 0));
}

simd_float4x4 lookAt(simd_float3 eye, simd_float3 target, simd_float3 up) {
  const simd_float3 z = simd_normalize(eye - target);
  const simd_float3 x = simd_normalize(simd_cross(up, z));
  const simd_float3 y = simd_cross(z, x);
  return simd_matrix(simd_make_float4(x.x, y.x, z.x, 0), simd_make_float4(x.y, y.y, z.y, 0), simd_make_float4(x.z, y.z, z.z, 0),
                     simd_make_float4(-simd_dot(x, eye), -simd_dot(y, eye), -simd_dot(z, eye), 1));
}

// Colours per PreviewRole, in enum order; the last entry is used for travel moves.
const float kRoleColors[][4] = {
    {0.50f, 0.50f, 0.50f, 1.f}, // None
    {1.00f, 0.90f, 0.30f, 1.f}, // Perimeter
    {1.00f, 0.49f, 0.22f, 1.f}, // ExternalPerimeter
    {0.12f, 0.12f, 1.00f, 1.f}, // OverhangPerimeter
    {0.69f, 0.19f, 0.16f, 1.f}, // InternalInfill
    {0.59f, 0.33f, 0.80f, 1.f}, // SolidInfill
    {0.94f, 0.25f, 0.25f, 1.f}, // TopSolidInfill
    {0.40f, 0.36f, 0.78f, 1.f}, // BottomSurface
    {1.00f, 0.55f, 0.41f, 1.f}, // Ironing
    {0.30f, 0.50f, 0.73f, 1.f}, // BridgeInfill
    {0.30f, 0.50f, 0.73f, 1.f}, // InternalBridgeInfill
    {1.00f, 1.00f, 1.00f, 1.f}, // GapFill
    {0.00f, 0.53f, 0.43f, 1.f}, // Skirt
    {0.00f, 0.53f, 0.43f, 1.f}, // Brim
    {0.00f, 1.00f, 0.00f, 1.f}, // Support
    {0.00f, 0.50f, 0.00f, 1.f}, // SupportInterface
    {0.35f, 0.60f, 0.30f, 1.f}, // SupportTransition
    {0.70f, 0.65f, 0.15f, 1.f}, // WipeTower
    {0.37f, 0.82f, 0.58f, 1.f}, // Custom
    {0.50f, 0.50f, 0.50f, 1.f}, // Mixed
    {0.10f, 0.60f, 1.00f, 1.f}, // Travel
};
constexpr size_t kTravelColor = sizeof(kRoleColors) / sizeof(kRoleColors[0]) - 1;

void push(std::vector<Vertex>& out, simd_float3 p, simd_float3 n, const float* c) {
  out.push_back(Vertex{{p.x, p.y, p.z}, {n.x, n.y, n.z}, {c[0], c[1], c[2], c[3]}});
}

} // namespace

@implementation OrcaViewportRenderer {
  __weak MTKView* _view;
  id<MTLDevice> _device;
  id<MTLCommandQueue> _queue;
  id<MTLRenderPipelineState> _pipeline;
  id<MTLDepthStencilState> _depthState;

  id<MTLBuffer> _triangleBuffer;
  NSUInteger _triangleVertexCount;
  id<MTLBuffer> _lineBuffer;
  NSUInteger _lineVertexCount;

  std::vector<Vertex> _bedLines;
  Slic3r::Mobile::PreviewData _preview;
  Bounds _bounds;

  // Orbit camera, z up.
  simd_float3 _target;
  float _yaw;
  float _pitch;
  float _distance;
}

- (instancetype)initWithView:(MTKView*)view {
  if ((self = [super init])) {
    _view = view;
    _device = MTLCreateSystemDefaultDevice();
    _queue = [_device newCommandQueue];
    _maxLayer = -1;
    _target = simd_make_float3(0, 0, 0);
    _yaw = 0.6f;
    _pitch = 0.5f;
    _distance = 400.f;

    view.device = _device;
    view.depthStencilPixelFormat = MTLPixelFormatDepth32Float;
    view.clearColor = MTLClearColorMake(0.93, 0.94, 0.95, 1.0);
    view.enableSetNeedsDisplay = YES;
    view.paused = YES;
    view.delegate = self;

    NSError* error = nil;
    id<MTLLibrary> library = [_device newLibraryWithSource:[NSString stringWithUTF8String:kShaderSource] options:nil error:&error];
    if (library == nil) {
      NSLog(@"OrcaViewport: shader compile failed: %@", error);
      return self;
    }
    MTLRenderPipelineDescriptor* desc = [MTLRenderPipelineDescriptor new];
    desc.vertexFunction = [library newFunctionWithName:@"orca_vertex"];
    desc.fragmentFunction = [library newFunctionWithName:@"orca_fragment"];
    desc.colorAttachments[0].pixelFormat = view.colorPixelFormat;
    desc.depthAttachmentPixelFormat = view.depthStencilPixelFormat;
    _pipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (_pipeline == nil) {
      NSLog(@"OrcaViewport: pipeline failed: %@", error);
    }
    MTLDepthStencilDescriptor* depth = [MTLDepthStencilDescriptor new];
    depth.depthCompareFunction = MTLCompareFunctionLessEqual;
    depth.depthWriteEnabled = YES;
    _depthState = [_device newDepthStencilStateWithDescriptor:depth];
  }
  return self;
}

#pragma mark - Properties

- (void)setMaxLayer:(NSInteger)maxLayer {
  _maxLayer = maxLayer;
  [self rebuildLines];
}

- (void)setShowTravels:(BOOL)showTravels {
  _showTravels = showTravels;
  [self rebuildLines];
}

#pragma mark - Geometry

- (void)reload {
  std::vector<Vertex> triangles;
  std::vector<Vertex> bed;
  Slic3r::Mobile::PreviewData preview;
  Bounds bounds;

  const bool previewMode = _mode == OrcaViewportModePreview;
  const bool found = margelo::nitro::orca::SessionRegistry::with(_sessionId, [&](Slic3r::Mobile::Session& session) {
    // Bed outline and a 10 mm grid.
    const Slic3r::Mobile::BedInfo info = session.bed();
    const float grey[4] = {0.55f, 0.58f, 0.60f, 1.f};
    const float light[4] = {0.78f, 0.80f, 0.82f, 1.f};
    const simd_float3 up = simd_make_float3(0, 0, 1);
    if (info.shape.size() >= 2) {
      float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
      for (size_t i = 0; i < info.shape.size(); ++i) {
        const auto& a = info.shape[i];
        const auto& b = info.shape[(i + 1) % info.shape.size()];
        push(bed, simd_make_float3(float(a[0]), float(a[1]), 0), up, grey);
        push(bed, simd_make_float3(float(b[0]), float(b[1]), 0), up, grey);
        minX = std::min(minX, float(a[0]));
        maxX = std::max(maxX, float(a[0]));
        minY = std::min(minY, float(a[1]));
        maxY = std::max(maxY, float(a[1]));
      }
      for (float x = std::ceil(minX / 10.f) * 10.f; x < maxX; x += 10.f) {
        push(bed, simd_make_float3(x, minY, 0), up, light);
        push(bed, simd_make_float3(x, maxY, 0), up, light);
      }
      for (float y = std::ceil(minY / 10.f) * 10.f; y < maxY; y += 10.f) {
        push(bed, simd_make_float3(minX, y, 0), up, light);
        push(bed, simd_make_float3(maxX, y, 0), up, light);
      }
      bounds.add(simd_make_float3(minX, minY, 0));
      bounds.add(simd_make_float3(maxX, maxY, 0));
    }

    if (previewMode) {
      preview = session.preview();
      for (const auto& v : preview.vertices) {
        if (v.type == Slic3r::Mobile::PreviewMoveType::Extrude) {
          bounds.add(simd_make_float3(v.position[0], v.position[1], v.position[2]));
        }
      }
    } else {
      const float body[4] = {0.55f, 0.72f, 0.62f, 1.f};
      for (const Slic3r::Mobile::ObjectInfo& object : session.objects()) {
        const Slic3r::Mobile::MeshData mesh = session.mesh(object.id);
        triangles.reserve(triangles.size() + mesh.triangles * 3);
        for (size_t i = 0; i + 2 < mesh.positions.size(); i += 3) {
          const simd_float3 p = simd_make_float3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
          const simd_float3 n = simd_make_float3(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
          push(triangles, p, n, body);
          bounds.add(p);
        }
      }
    }
  });
  if (!found) {
    // Unknown session or a slice in progress: keep what is on screen.
    return;
  }

  _bedLines = std::move(bed);
  _preview = std::move(preview);
  const bool hadBounds = _bounds.valid;
  _bounds = bounds;
  _triangleVertexCount = triangles.size();
  _triangleBuffer = triangles.empty() ? nil
                                      : [_device newBufferWithBytes:triangles.data()
                                                             length:triangles.size() * sizeof(Vertex)
                                                            options:MTLResourceStorageModeShared];
  [self rebuildLines];
  if (!hadBounds) {
    [self fit];
  }
  [_view setNeedsDisplay];
}

- (void)rebuildLines {
  std::vector<Vertex> lines = _bedLines;
  if (_mode == OrcaViewportModePreview && _preview.vertices.size() > 1) {
    const simd_float3 up = simd_make_float3(0, 0, 1);
    lines.reserve(lines.size() + _preview.vertices.size() * 2);
    for (size_t i = 1; i < _preview.vertices.size(); ++i) {
      const Slic3r::Mobile::PreviewVertex& a = _preview.vertices[i - 1];
      const Slic3r::Mobile::PreviewVertex& b = _preview.vertices[i];
      if (_maxLayer >= 0 && b.layer_id > static_cast<unsigned int>(_maxLayer)) {
        continue;
      }
      const float* color = nullptr;
      if (b.type == Slic3r::Mobile::PreviewMoveType::Extrude) {
        const size_t role = static_cast<size_t>(b.role);
        color = kRoleColors[std::min(role, kTravelColor - 1)];
      } else if (_showTravels && b.type == Slic3r::Mobile::PreviewMoveType::Travel) {
        color = kRoleColors[kTravelColor];
      }
      if (color == nullptr) {
        continue;
      }
      push(lines, simd_make_float3(a.position[0], a.position[1], a.position[2]), up, color);
      push(lines, simd_make_float3(b.position[0], b.position[1], b.position[2]), up, color);
    }
  }
  _lineVertexCount = lines.size();
  _lineBuffer = lines.empty() ? nil
                              : [_device newBufferWithBytes:lines.data() length:lines.size() * sizeof(Vertex) options:MTLResourceStorageModeShared];
  [_view setNeedsDisplay];
}

#pragma mark - Camera

- (void)fit {
  _target = _bounds.valid ? _bounds.center() : simd_make_float3(0, 0, 0);
  const float radius = std::max(_bounds.radius(), 20.f);
  _distance = radius / sinf(0.35f) * 1.15f;
  [_view setNeedsDisplay];
}

- (void)orbitBy:(CGPoint)delta {
  _yaw += float(delta.x) * 0.01f;
  _pitch = std::clamp(_pitch + float(delta.y) * 0.01f, -1.5f, 1.5f);
  [_view setNeedsDisplay];
}

- (void)panBy:(CGPoint)delta {
  // Move the target in the camera's screen plane, scaled so a drag follows the finger.
  const float scale = _distance * 0.0015f;
  const simd_float3 forward = simd_normalize(simd_make_float3(sinf(_yaw) * cosf(_pitch), cosf(_yaw) * cosf(_pitch), sinf(_pitch)));
  const simd_float3 right = simd_normalize(simd_cross(forward, simd_make_float3(0, 0, 1)));
  const simd_float3 upv = simd_cross(right, forward);
  _target = _target - right * (float(delta.x) * scale) + upv * (float(delta.y) * scale);
  [_view setNeedsDisplay];
}

- (void)zoomBy:(CGFloat)factor {
  if (factor > 0) {
    _distance = std::clamp(_distance / float(factor), 5.f, 5000.f);
    [_view setNeedsDisplay];
  }
}

- (simd_float4x4)viewProjectionForSize:(CGSize)size {
  const simd_float3 offset = simd_make_float3(sinf(_yaw) * cosf(_pitch), cosf(_yaw) * cosf(_pitch), sinf(_pitch)) * _distance;
  const simd_float3 eye = _target + offset;
  const simd_float4x4 view = lookAt(eye, _target, simd_make_float3(0, 0, 1));
  const float aspect = size.height > 0 ? float(size.width / size.height) : 1.f;
  const simd_float4x4 projection = perspective(0.7f, aspect, std::max(_distance * 0.01f, 0.1f), _distance * 10.f + 1000.f);
  return simd_mul(projection, view);
}

#pragma mark - MTKViewDelegate

- (void)mtkView:(MTKView*)view drawableSizeWillChange:(CGSize)size {
  [view setNeedsDisplay];
}

- (void)drawInMTKView:(MTKView*)view {
  if (_pipeline == nil) {
    return;
  }
  MTLRenderPassDescriptor* pass = view.currentRenderPassDescriptor;
  id<CAMetalDrawable> drawable = view.currentDrawable;
  if (pass == nil || drawable == nil) {
    return;
  }

  Uniforms uniforms;
  uniforms.mvp = [self viewProjectionForSize:view.drawableSize];
  uniforms.lightDir = simd_make_float4(0.3f, -0.5f, 0.8f, 0);

  id<MTLCommandBuffer> commands = [_queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
  [encoder setRenderPipelineState:_pipeline];
  [encoder setDepthStencilState:_depthState];
  [encoder setCullMode:MTLCullModeNone];

  if (_lineBuffer != nil) {
    uniforms.params = simd_make_float4(0, 0, 0, 0);
    [encoder setVertexBuffer:_lineBuffer offset:0 atIndex:0];
    [encoder setVertexBytes:&uniforms length:sizeof(uniforms) atIndex:1];
    [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:_lineVertexCount];
  }
  if (_triangleBuffer != nil) {
    uniforms.params = simd_make_float4(1, 0, 0, 0);
    [encoder setVertexBuffer:_triangleBuffer offset:0 atIndex:0];
    [encoder setVertexBytes:&uniforms length:sizeof(uniforms) atIndex:1];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_triangleVertexCount];
  }

  [encoder endEncoding];
  [commands presentDrawable:drawable];
  [commands commit];
}

@end
