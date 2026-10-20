#include "PluginPipeline.hpp"

#include <libslic3r/PrintConfig.hpp>
#include <libslic3r/libslic3r.h> // SoftFever_VERSION
#include <slic3r/plugin/PluginManager.hpp>
#include <slic3r/plugin/PythonInterpreter.hpp>
#include <slic3r/plugin/pluginTypes/slicingPipeline/SlicingPipelinePluginCapability.hpp>

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <memory>
#include <stdexcept>

namespace Slic3r { namespace Mobile { namespace Plugins {

void post_process_gcode(const std::string& gcode_path, const std::string& output_name, const DynamicPrintConfig& config)
{
    const auto* capabilities = config.opt<ConfigOptionStrings>("slicing_pipeline_plugin");
    if (capabilities == nullptr || capabilities->values.empty())
        return;
    const auto* plugins = config.opt<ConfigOptionStrings>("plugins");

    auto execute_fn = [&](std::shared_ptr<SlicingPipelinePluginCapability> cap, const PluginCapabilityRef& ref) {
        SlicingPipelineContext ctx;
        ctx.orca_version = SoftFever_VERSION;
        ctx.step         = SlicingPipelineStepPlugin::psGCodePostProcess;
        ctx.gcode_path   = gcode_path;
        ctx.host         = "File";
        ctx.output_name  = output_name;
        ctx.full_config  = &config;

        ExecutionResult result;
        try {
            PythonGILState gil;
            if (!gil)
                throw std::runtime_error("Python interpreter is shutting down");
            result = cap->execute(ctx);
        } catch (const std::exception& ex) {
            throw std::runtime_error("Post-processing plugin " + ref.capability_name + " raised an exception.\nError: " + ex.what());
        }
        if (result.status == PluginResult::RecoverableError || result.status == PluginResult::FatalError)
            throw std::runtime_error("Post-processing plugin " + ref.capability_name + " failed.\nError: " + result.message);
        if (!result.message.empty())
            BOOST_LOG_TRIVIAL(info) << "Post-processing plugin " << ref.capability_name << ": " << result.message;
        if (!boost::filesystem::exists(gcode_path))
            throw std::runtime_error("Post-processing plugin " + ref.capability_name +
                                     " deleted the G-code file instead of editing it in place.");
    };

    execute_capabilities_from_refs<SlicingPipelinePluginCapability>(*capabilities, plugins, PluginCapabilityType::SlicingPipeline,
                                                                    execute_fn);
}

}}} // namespace Slic3r::Mobile::Plugins
