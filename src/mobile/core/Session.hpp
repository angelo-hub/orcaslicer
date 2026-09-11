#pragma once

#include <array>
#include <functional>
#include <memory>
#include <string>
#include <vector>

// A slicing session: the presets, the model and the print of one project.
//
// One Session is one project. The bridge layer owns the instance, serializes every call
// on a single worker thread, and marshals progress callbacks to the UI thread; nothing
// here is thread-safe except cancel(), which may be called from any thread while
// slice() runs. Slicing is synchronous by design: the bridge decides how it runs.
//
// libslic3r types never appear in this header so the bridge and the renderer compile
// without the core's include tree.
namespace Slic3r {
class Model;
class Print;
class PresetBundle;
struct GCodeProcessorResult;
}

namespace Slic3r { namespace Mobile {

enum class PresetKind { Printer, Filament, Process };

struct PresetInfo
{
    std::string name;
    std::string vendor;       // vendor id for system presets, empty otherwise
    bool        is_system     = false;
    bool        is_user       = false;
    bool        is_visible    = false; // installed in the desktop sense; the app may ignore this
    bool        is_compatible = false; // with the selected printer
    bool        is_selected   = false;
};

using Vec3 = std::array<double, 3>;

struct ObjectInfo
{
    unsigned long id = 0;   // stable for the life of the session
    std::string   name;
    Vec3          position { 0, 0, 0 }; // instance offset, mm
    Vec3          rotation { 0, 0, 0 }; // Euler angles, radians
    Vec3          scale    { 1, 1, 1 };
    Vec3          size     { 0, 0, 0 }; // world-space bounding box, mm
    unsigned long triangles = 0;
};

struct BedInfo
{
    std::vector<std::array<double, 2>> shape; // printable area polygon, mm
    double                             height = 0; // printable height, mm
};

struct Progress
{
    int         percent = 0;
    std::string message;
};

enum class SliceOutcome { Finished, Cancelled, Failed };

struct SliceWarning
{
    std::string text;
    bool        critical = false;
};

struct SliceResult
{
    SliceOutcome              outcome = SliceOutcome::Failed;
    std::string               error;      // set when outcome is Failed
    std::vector<SliceWarning> warnings;
};

struct SliceStatistics
{
    double        print_time_s      = 0; // normal mode estimate
    double        filament_mm3      = 0; // total extruded volume
    double        filament_g        = 0; // by filament density where known
    double        filament_cost     = 0;
    unsigned long layer_count       = 0;
};

class Session
{
public:
    Session();
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    // Presets. load_presets() reads the vendor profiles from the resources directory and
    // the user presets from the data directory; returns an error text or an empty string.
    std::string              load_presets();
    std::vector<PresetInfo>  presets(PresetKind kind) const;
    std::string              selected_preset(PresetKind kind) const;
    // Select by name. Filaments are per extruder; select_preset selects extruder 0.
    bool                     select_preset(PresetKind kind, const std::string& name);
    bool                     select_filament(size_t extruder, const std::string& name);
    BedInfo                  bed() const;

    // Options, read and written on the edited preset that owns the key. Values are in
    // the serialized form libslic3r uses in its config files ("0.2", "1,2,3", "nil").
    std::string              option(const std::string& key) const;
    bool                     set_option(const std::string& key, const std::string& value);
    // Keys whose edited value differs from the selected preset, per kind.
    std::vector<std::string> modified_options(PresetKind kind) const;
    void                     discard_modified_options(PresetKind kind);
    // Every print, filament and printer option definition as a JSON array: key, type,
    // label, category, tooltip, unit, mode, default, enum values and labels, min, max.
    static std::string       option_definitions_json();

    // Model. import() reads STL, OBJ, 3MF, STEP, AMF or any format libslic3r accepts,
    // places the new objects on the bed and returns them. Throws std::runtime_error.
    std::vector<ObjectInfo>  import(const std::string& path);
    std::vector<ObjectInfo>  objects() const;
    bool                     remove_object(unsigned long id);
    bool                     set_transform(unsigned long id, const Vec3& position, const Vec3& rotation, const Vec3& scale);
    void                     clear();
    void                     arrange();

    // Slicing. slice() blocks until the print is processed, cancelled or fails and
    // invalidates any earlier result. cancel() may be called from another thread.
    using ProgressFn = std::function<void(const Progress&)>;
    SliceResult              slice(const ProgressFn& on_progress);
    void                     cancel();
    bool                     is_sliced() const;

    // Export the processed print. Returns the path written; throws std::runtime_error.
    std::string              export_gcode(const std::string& path);
    SliceStatistics          statistics() const;

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

}} // namespace Slic3r::Mobile
