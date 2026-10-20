#include <slic3r/plugin/host/PluginHostBindings.hpp>

#include <stdexcept>
#include <string>

// orca.host.plater() / model() / preset_bundle() / app_language() without a Plater. The
// live model and presets belong to a Session the bridge locks per call, so until the
// slicing-pipeline hooks hand a plugin that session they are not reachable from here.

namespace Slic3r {

namespace Mobile { namespace Plugins { std::string app_language(); } }

namespace py = pybind11;

void host_bindings::register_app(py::module_& host)
{
    auto unavailable = [](const char* what) {
        return [what]() -> py::object { throw std::runtime_error(std::string(what) + " is not available on this device"); };
    };
    host.def("plater", unavailable("orca.host.plater()"));
    host.def("model", unavailable("orca.host.model()"));
    host.def("preset_bundle", unavailable("orca.host.preset_bundle()"));
    host.def("app_language", []() { return Mobile::Plugins::app_language(); });
}

} // namespace Slic3r
