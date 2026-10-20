#include "PluginEvents.hpp"

#include <slic3r/plugin/host/PluginHostUi.hpp>

#include <nlohmann/json.hpp>
#include <pybind11/pybind11.h>

#include <atomic>
#include <chrono>
#include <stdexcept>
#include <string>

// orca.host.ui on a device: the same names and signatures as host/PluginHostUi.cpp binds
// on the desktop, over the event channel instead of wx. message() blocks for the app's
// answer; a progress dialog is a stream of ui-progress events; HTML windows are not
// available yet (the pages capability is the way to show HTML here).

namespace Slic3r {

namespace py   = pybind11;
using json     = nlohmann::json;
using namespace std::chrono_literals;

namespace {

constexpr auto MESSAGE_WAIT = 300s;

// The desktop's wx style values, so a plugin that ORs the constants gets the same numbers.
constexpr long PD_CAN_ABORT      = 0x0010;
constexpr long PD_APP_MODAL      = 0x0020;
constexpr long PD_AUTO_HIDE      = 0x0040;
constexpr long PD_ELAPSED_TIME   = 0x0080;
constexpr long PD_ESTIMATED_TIME = 0x0100;
constexpr long PD_REMAINING_TIME = 0x0200;
constexpr long PD_CAN_SKIP       = 0x0400;
constexpr long WINDOW_MODELESS   = 0L;
constexpr long WINDOW_MODAL      = 1L << 0;

std::atomic<int> s_next_progress_id{1};

std::string ui_message(const std::string& text, const std::string& title, const std::string& buttons, const std::string& icon)
{
    const json payload = {{"text", text}, {"title", title}, {"buttons", buttons}, {"icon", icon}};
    std::optional<std::string> reply;
    {
        // The app answers on its own thread; waiting with the GIL held would block every
        // other plugin call meanwhile.
        py::gil_scoped_release release;
        reply = Mobile::plugin_events::ask({"ui-message", "", "", payload.dump()}, MESSAGE_WAIT);
    }
    return reply.value_or("cancel");
}

struct UiWindowHandle
{
    int id{0};
};

struct UiProgressHandle
{
    int  id{0};
    bool open{true};
};

void progress_event(const UiProgressHandle& h, const std::string& title, const std::string& message, int value, int maximum)
{
    const json payload = {{"id", h.id}, {"title", title}, {"message", message}, {"value", value}, {"maximum", maximum},
                          {"open", h.open}};
    Mobile::plugin_events::emit({"ui-progress", "", "", payload.dump()});
}

UiProgressHandle new_progress(const std::string& title, const std::string& message, int maximum, long)
{
    UiProgressHandle h{s_next_progress_id++, true};
    progress_event(h, title, message, 0, maximum);
    return h;
}

} // namespace

void PluginHostUi::RegisterBindings(py::module_& host)
{
    auto ui = host.def_submodule("ui", "Host UI: message boxes and progress reports, shown by the app.");

    ui.def("message", &ui_message, py::arg("text"), py::arg("title") = "OrcaSlicer", py::arg("buttons") = "ok",
           py::arg("icon") = "info",
           "Show a modal message box; returns the clicked button id (\"ok\"/\"cancel\"/\"yes\"/\"no\"). "
           "buttons: \"ok\"|\"ok_cancel\"|\"yes_no\"|\"yes_no_cancel\"; icon: \"info\"|\"warning\"|\"error\"|\"question\".");

    ui.attr("PD_APP_MODAL")      = py::int_(PD_APP_MODAL);
    ui.attr("PD_AUTO_HIDE")      = py::int_(PD_AUTO_HIDE);
    ui.attr("PD_CAN_ABORT")      = py::int_(PD_CAN_ABORT);
    ui.attr("PD_CAN_SKIP")       = py::int_(PD_CAN_SKIP);
    ui.attr("PD_ELAPSED_TIME")   = py::int_(PD_ELAPSED_TIME);
    ui.attr("PD_ESTIMATED_TIME") = py::int_(PD_ESTIMATED_TIME);
    ui.attr("PD_REMAINING_TIME") = py::int_(PD_REMAINING_TIME);
    ui.attr("WINDOW_MODELESS")   = py::int_(WINDOW_MODELESS);
    ui.attr("WINDOW_MODAL")      = py::int_(WINDOW_MODAL);

    py::class_<UiWindowHandle>(ui, "UiWindow", "Handle to a plugin HTML window; not available on this device.")
        .def_property_readonly("id", [](const UiWindowHandle& h) { return h.id; })
        .def("post", [](const UiWindowHandle&, py::object) {}, py::arg("data"))
        .def("close", [](const UiWindowHandle&) {})
        .def("is_open", [](const UiWindowHandle&) { return false; });

    ui.def(
        "create_window",
        [](const std::string&, const std::string&, int, int, py::object, py::object, long, py::object) -> UiWindowHandle {
            throw std::runtime_error("orca.host.ui.create_window() is not available on this device; use a pages capability");
        },
        py::arg("html"), py::arg("title") = "OrcaSlicer", py::arg("width") = 820, py::arg("height") = 600,
        py::arg("on_message") = py::none(), py::arg("on_close") = py::none(), py::arg("style") = WINDOW_MODELESS,
        py::arg("on_submit") = py::none());

    py::class_<UiProgressHandle>(ui, "ProgressDialog", "Handle to a progress report the app shows.")
        .def(py::init(&new_progress), py::arg("title"), py::arg("message"), py::arg("maximum") = 100,
             py::arg("style") = PD_APP_MODAL | PD_AUTO_HIDE)
        .def_property_readonly("id", [](const UiProgressHandle& h) { return h.id; })
        .def(
            "pulse",
            [](const UiProgressHandle& h, const std::string& message) {
                progress_event(h, "", message, -1, 0);
                return h.open;
            },
            py::arg("message") = "")
        .def(
            "update",
            [](const UiProgressHandle& h, int value, const std::string& message) {
                progress_event(h, "", message, value, 0);
                return h.open;
            },
            py::arg("value"), py::arg("message") = "")
        .def("start_pulse", [](const UiProgressHandle&, int, const std::string&) {}, py::arg("interval_ms") = 100,
             py::arg("message") = "")
        .def("stop_pulse", [](const UiProgressHandle&) {})
        .def("close",
             [](UiProgressHandle& h) {
                 h.open = false;
                 progress_event(h, "", "", 0, 0);
             })
        .def("is_open", [](const UiProgressHandle& h) { return h.open; })
        .def("__enter__", [](UiProgressHandle& h) -> UiProgressHandle& { return h; }, py::return_value_policy::reference_internal)
        .def("__exit__", [](UiProgressHandle& h, py::object, py::object, py::object) {
            h.open = false;
            progress_event(h, "", "", 0, 0);
            return false;
        });

    ui.def("create_progress_dialog", &new_progress, py::arg("title"), py::arg("message"), py::arg("maximum") = 100,
           py::arg("style") = PD_APP_MODAL | PD_AUTO_HIDE);
}

void PluginHostUi::close_windows_for_plugin(const std::string&) {}

} // namespace Slic3r
