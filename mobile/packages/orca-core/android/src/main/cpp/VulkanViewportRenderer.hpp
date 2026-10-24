#pragma once

// The Vulkan backend of the viewport, the Android counterpart of ios/OrcaViewportRenderer.mm.
// The platform-neutral part (scene building, toolpath segments and filtering, camera,
// picking, drag) lives in cpp/viewport/; this class only uploads the controller's vectors
// and draws them into the window the Kotlin view hands it.
//
// Not thread-safe: the Kotlin view calls it from the UI thread, like the controller.

#include "viewport/ViewportController.hpp"

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

namespace orca::viewport {

class VulkanViewportRenderer {
public:
  // Null when the device has no usable Vulkan driver; the view then shows a placeholder.
  static std::unique_ptr<VulkanViewportRenderer> create(ViewportController::RedrawRequest redraw);
  ~VulkanViewportRenderer();

  VulkanViewportRenderer(const VulkanViewportRenderer&) = delete;
  VulkanViewportRenderer& operator=(const VulkanViewportRenderer&) = delete;

  ViewportController& controller() { return *controller_; }

  // The window to draw into; takes its own reference. False when Vulkan cannot present
  // to it, in which case nothing is drawn.
  bool setWindow(ANativeWindow* window);
  // The window's size changed; the swapchain is rebuilt on the next draw.
  void windowResized() { swapchainStale_ = true; }
  // Waits for the GPU and lets go of the window and everything sized to it.
  void releaseWindow();

  void draw();

  // RGBA8 pixels, top row first as Android bitmaps store them. Replaces the bed texture.
  void setBedTexture(const uint8_t* pixels, uint32_t width, uint32_t height, uint32_t stride);
  void clearBedTexture();

private:
  struct Buffer {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    void* mapped = nullptr;
    VkDeviceSize size = 0;
  };
  struct Image {
    VkImage image = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VkImageView view = VK_NULL_HANDLE;
  };

  explicit VulkanViewportRenderer(ViewportController::RedrawRequest redraw);
  bool initDevice();
  bool initPipelineObjects();
  bool createSwapchain();
  void destroySwapchain();
  bool createRenderPassAndPipelines(VkFormat colorFormat);
  void destroyRenderPassAndPipelines();
  VkPipeline makePipeline(VkShaderModule vert, VkShaderModule frag, const VkPipelineVertexInputStateCreateInfo& input,
                          VkPrimitiveTopology topology);

  uint32_t memoryType(uint32_t typeBits, VkMemoryPropertyFlags required, VkMemoryPropertyFlags preferred) const;
  Buffer makeBuffer(const void* data, VkDeviceSize size, VkBufferUsageFlags usage);
  template <typename T> Buffer makeBuffer(const std::vector<T>& items, VkBufferUsageFlags usage) {
    return makeBuffer(items.data(), items.size() * sizeof(T), usage);
  }
  void destroy(Buffer& buffer);
  Image makeAttachment(VkFormat format, VkImageUsageFlags usage, VkImageAspectFlags aspect);
  void destroy(Image& image);

  void syncBuffers();
  // Grows the uniform ring to hold `count` draws and points the descriptor at it.
  void reserveUniforms(std::size_t count);

  ViewportController::RedrawRequest redraw_;
  std::unique_ptr<ViewportController> controller_;

  VkInstance instance_ = VK_NULL_HANDLE;
  VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
  VkPhysicalDeviceMemoryProperties memoryProperties_{};
  VkDeviceSize uniformAlignment_ = 256;
  uint32_t queueFamily_ = 0;
  VkDevice device_ = VK_NULL_HANDLE;
  VkQueue queue_ = VK_NULL_HANDLE;
  VkCommandPool commandPool_ = VK_NULL_HANDLE;
  VkCommandBuffer commandBuffer_ = VK_NULL_HANDLE;
  // One frame in flight: the viewport draws on demand, never continuously.
  VkFence frameFence_ = VK_NULL_HANDLE;
  VkSemaphore imageAvailable_ = VK_NULL_HANDLE;
  VkFormat depthFormat_ = VK_FORMAT_UNDEFINED;

  VkDescriptorSetLayout uniformLayout_ = VK_NULL_HANDLE;
  VkDescriptorSetLayout textureLayout_ = VK_NULL_HANDLE;
  VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
  VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
  VkDescriptorSet uniformSet_ = VK_NULL_HANDLE;
  VkDescriptorSet textureSet_ = VK_NULL_HANDLE;
  VkSampler sampler_ = VK_NULL_HANDLE;
  std::vector<VkShaderModule> shaderModules_;

  // Sized to the window.
  ANativeWindow* window_ = nullptr;
  VkSurfaceKHR surface_ = VK_NULL_HANDLE;
  VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
  VkFormat colorFormat_ = VK_FORMAT_UNDEFINED;
  VkExtent2D extent_{};
  std::vector<VkImageView> swapchainViews_;
  std::vector<VkFramebuffer> framebuffers_;
  std::vector<VkSemaphore> renderFinished_;
  // Multisampled colour and depth, resolved into the swapchain image. Transient and,
  // where the GPU offers it, lazily allocated: they live in tile memory and cost no
  // RAM, the counterpart of Metal's memoryless targets.
  Image msaaColor_;
  Image msaaDepth_;
  bool swapchainStale_ = false;

  // Depend on the swapchain's colour format only, so they survive a resize.
  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  VkPipeline linePipeline_ = VK_NULL_HANDLE;
  VkPipeline segmentLinePipeline_ = VK_NULL_HANDLE;
  VkPipeline ribbonPipeline_ = VK_NULL_HANDLE;
  VkPipeline meshPipeline_ = VK_NULL_HANDLE;
  VkPipeline bedPipeline_ = VK_NULL_HANDLE;

  // GPU copies of the controller's geometry, refreshed when its revisions change.
  uint32_t sceneRevision_ = 0;
  uint32_t toolpathRevision_ = 0;
  Buffer bedLineBuffer_;
  Buffer bedModelBuffer_;
  Buffer bedQuadBuffer_;
  Buffer meshBuffer_;
  Buffer extrusionBuffer_;
  Buffer markerBuffer_;
  // One aligned Uniforms slot per draw, bound with a dynamic offset: the struct is
  // larger than the 128 bytes of push constants every device guarantees.
  Buffer uniformRing_;
  std::size_t uniformCapacity_ = 0;
  Image bedTexture_;
};

} // namespace orca::viewport
