#include "PluginPermissionPrompt.hpp"

#include "GUI_App.hpp"
#include "I18N.hpp"

#include <future>
#include <memory>

#include <wx/msgdlg.h>
#include <wx/thread.h>

namespace Slic3r::GUI {

namespace {

wxString audit_message(AuditEventCategory category, const wxString& plugin_name, const wxString& event_name,
                       const wxString& target_list)
{
    if (target_list.IsEmpty())
        return wxString::Format(
            _L("Plugin \"%s\" is requesting permission for the Python audit event \"%s\".\n\n"
                "This operation does not expose a target the audit hook can display."),
            plugin_name, event_name);

    switch (category) {
    case AuditEventCategory::FsRead:
        return wxString::Format(_L("Plugin \"%s\" is requesting to read the following file(s):\n%s"), plugin_name, target_list);
    case AuditEventCategory::FsReadWrite:
        return wxString::Format(_L("Plugin \"%s\" is requesting to read/write the following file(s):\n%s"), plugin_name, target_list);
    case AuditEventCategory::FsCreate:
        return wxString::Format(_L("Plugin \"%s\" is requesting to create the following file(s):\n%s"), plugin_name, target_list);
    case AuditEventCategory::FsDelete:
        return wxString::Format(_L("Plugin \"%s\" is requesting to delete the following file(s):\n%s"), plugin_name, target_list);
    case AuditEventCategory::Http:
        return wxString::Format(_L("Plugin \"%s\" is requesting to make an HTTP request to:\n%s"), plugin_name, target_list);
    case AuditEventCategory::Socket:
        return wxString::Format(_L("Plugin \"%s\" is requesting to open a network connection to:\n%s"), plugin_name, target_list);
    case AuditEventCategory::ProcessCreate:
        return wxString::Format(_L("Plugin \"%s\" is requesting to run the following command(s):\n%s"), plugin_name, target_list);
    default:
        return wxString::Format(_L("Plugin \"%s\" is requesting permission for the Python audit event \"%s\"."), plugin_name, event_name);
    }
}

bool show_dialog(const PluginPermissionRequest& request)
{
    wxString target_list;
    for (const auto& target : request.targets)
        target_list += wxString::FromUTF8(target.c_str()) + "\n";

    wxMessageDialog dialog(nullptr,
                           audit_message(request.category, wxString::FromUTF8(request.plugin_name.c_str()),
                                         wxString::FromUTF8(request.event_name.c_str()), target_list),
                           _L("Plugin permission request"), wxYES_NO | wxICON_WARNING);
    return dialog.ShowModal() == wxID_YES;
}

} // namespace

bool prompt_plugin_permission(const PluginPermissionRequest& request)
{
    if (wxTheApp == nullptr || wxGetApp().is_closing())
        return false;
    if (wxIsMainThread())
        return show_dialog(request);

    auto result = std::make_shared<std::promise<bool>>();
    auto future = result->get_future();
    wxGetApp().CallAfter([result, request] { result->set_value(show_dialog(request)); });
    return future.get();
}

} // namespace Slic3r::GUI
