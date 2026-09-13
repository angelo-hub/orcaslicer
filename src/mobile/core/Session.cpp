#include "Session.hpp"

#include "libslic3r/AppConfig.hpp"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ModelArrange.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintBase.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cfloat>
#include <stdexcept>

namespace Slic3r { namespace Mobile {

struct Session::Impl
{
    PresetBundle         bundle;
    Model                model;
    Print                print;
    GCodeProcessorResult gcode_result;
    bool                 sliced   = false;
    bool                 exported = false;

    PresetCollection& collection(PresetKind kind)
    {
        switch (kind) {
        case PresetKind::Printer:  return bundle.printers;
        case PresetKind::Filament: return bundle.filaments;
        default:                   return bundle.prints;
        }
    }
    const PresetCollection& collection(PresetKind kind) const { return const_cast<Impl*>(this)->collection(kind); }

    // The collection whose presets carry `key`, or nullptr for keys outside the presets.
    PresetCollection* owner_of(const std::string& key)
    {
        auto contains = [&key](const std::vector<std::string>& keys) {
            return std::find(keys.begin(), keys.end(), key) != keys.end();
        };
        if (contains(Preset::print_options()))    return &bundle.prints;
        if (contains(Preset::filament_options())) return &bundle.filaments;
        if (contains(Preset::printer_options()))  return &bundle.printers;
        return nullptr;
    }

    ModelObject* find_object(unsigned long id) const
    {
        for (ModelObject* o : model.objects)
            if (o->id().id == id)
                return o;
        return nullptr;
    }

    ObjectInfo info(const ModelObject& o) const
    {
        ObjectInfo out;
        out.id   = static_cast<unsigned long>(o.id().id);
        out.name = o.name;
        if (! o.instances.empty()) {
            const ModelInstance& inst = *o.instances.front();
            const Vec3d offset = inst.get_offset(), rotation = inst.get_rotation(), scale = inst.get_scaling_factor();
            out.position = { offset.x(), offset.y(), offset.z() };
            out.rotation = { rotation.x(), rotation.y(), rotation.z() };
            out.scale    = { scale.x(), scale.y(), scale.z() };
        }
        const Vec3d size = o.bounding_box_exact().size();
        out.size      = { size.x(), size.y(), size.z() };
        out.triangles = static_cast<unsigned long>(o.facets_count());
        return out;
    }

    BoundingBoxf bed_bbox() const
    {
        BoundingBoxf bb;
        // Same guard as Session::bed(): full_config() dereferences null when
        // no printer preset has been picked yet. A 200×200 mm default lets
        // the model be imported and centered before the user picks a printer.
        if (bundle.printers.get_edited_preset().is_default) {
            bb.merge(Vec2d(0.0, 0.0));
            bb.merge(Vec2d(200.0, 200.0));
            return bb;
        }
        for (const Point& p : get_bed_shape(bundle.full_config()))
            bb.merge(Vec2d(unscaled<double>(p.x()), unscaled<double>(p.y())));
        return bb;
    }

    // Find the index of a preset by name in a collection, or size_t(-1).
    static size_t index_of(const PresetCollection& c, const std::string& name)
    {
        size_t idx = 0;
        for (const Preset& p : c.get_presets()) {
            if (p.name == name)
                return idx;
            ++ idx;
        }
        return size_t(-1);
    }
};

Session::Session() : m_impl(std::make_unique<Impl>()) {}
Session::~Session() = default;

static std::string load_presets_into(PresetBundle& bundle, bool force_refresh)
{
    bundle.setup_directories();

    namespace fs = boost::filesystem;
    const fs::path system_dir = fs::path(data_dir()) / "system";

    // System presets are read from data_dir/system, where the desktop's updater
    // installs the vendors the user enabled from resources/profiles. On a normal
    // reload we only install the vendors whose version bumped; on a forced
    // refresh (e.g. right after the app installed or removed a vendor) we wipe
    // the mirror so a same-version reinstall really re-copies, including a
    // vendor whose files were corrupt from a previous partial download, and a
    // vendor removed from resources drops out of the mirror too.
    if (force_refresh && fs::exists(system_dir)) {
        boost::system::error_code ec;
        fs::remove_all(system_dir, ec);
        // ignore ec: a partial wipe is corrected by the reinstall that follows
    }
    // Recreate the (possibly empty) mirror directory so load_presets's
    // directory_iterator does not throw when no vendor exists in resources
    // (i.e. right after the last remaining vendor was uninstalled).
    boost::system::error_code ec;
    fs::create_directories(system_dir, ec);

    std::vector<std::string> to_install;
    for (const std::string& vendor : vendor_names_in(fs::path(resources_dir()) / "profiles"))
        if (! is_vendor_installed(vendor) || installed_vendor_version(vendor) < resource_vendor_version(vendor))
            to_install.push_back(vendor);
    if (! to_install.empty())
        install_vendor_bundles_from_resources(to_install);

    AppConfig app_config;
    if (! app_config.load_if_exists().empty())
        app_config.reset();
    std::string errors;
    bundle.load_presets(app_config, ForwardCompatibilitySubstitutionRule::Enable, PresetBundle::PresetPreferences(), &errors);
    return errors;
}

std::string Session::load_presets() { return load_presets_into(m_impl->bundle, /*force_refresh=*/false); }

std::string Session::reload_presets() { return load_presets_into(m_impl->bundle, /*force_refresh=*/true); }

std::vector<PresetInfo> Session::presets(PresetKind kind) const
{
    const Impl&             im = *m_impl;
    const PresetCollection& c  = im.collection(kind);
    const std::string       selected = this->selected_preset(kind);
    std::vector<PresetInfo> out;
    for (const Preset& p : c.get_presets()) {
        if (p.is_default)
            continue;
        PresetInfo info;
        info.name          = p.name;
        info.vendor        = p.vendor ? p.vendor->id : std::string();
        info.is_system     = p.is_system;
        info.is_user       = p.is_user();
        info.is_visible    = p.is_visible;
        info.is_compatible = p.is_compatible;
        info.is_selected   = p.name == selected;
        out.push_back(std::move(info));
    }
    return out;
}

std::string Session::selected_preset(PresetKind kind) const
{
    const Impl& im = *m_impl;
    if (kind == PresetKind::Filament)
        return im.bundle.filament_presets.empty() ? std::string() : im.bundle.filament_presets.front();
    return im.collection(kind).get_selected_preset().name;
}

bool Session::select_preset(PresetKind kind, const std::string& name)
{
    if (kind == PresetKind::Filament)
        return this->select_filament(0, name);
    Impl&             im  = *m_impl;
    PresetCollection& c   = im.collection(kind);
    const size_t      idx = Impl::index_of(c, name);
    if (idx == size_t(-1))
        return false;
    // select_preset_by_name() only accepts presets the desktop marked as installed; the
    // app decides what to show, so select by index instead.
    c.select_preset(idx);
    if (kind == PresetKind::Printer) {
        im.bundle.update_multi_material_filament_presets();
        im.bundle.update_compatible(PresetSelectCompatibleType::Never);
    }
    im.sliced = false;
    return true;
}

bool Session::select_filament(size_t extruder, const std::string& name)
{
    Impl&        im  = *m_impl;
    const size_t idx = Impl::index_of(im.bundle.filaments, name);
    if (idx == size_t(-1) || extruder >= im.bundle.filament_presets.size())
        return false;
    im.bundle.set_filament_preset(extruder, name);
    if (extruder == 0)
        im.bundle.filaments.select_preset(idx);
    im.sliced = false;
    return true;
}

BedInfo Session::bed() const
{
    const Impl& im = *m_impl;
    BedInfo out;
    // Callers (notably the Metal viewport) may ask for the bed before any
    // vendor bundle is installed. PresetBundle::full_config() walks the
    // filament presets against the printer's extruder list and crashes when
    // that has never been populated. A default 200×200 mm plate keeps the
    // viewport drawable until a printer preset is picked.
    if (im.bundle.printers.get_edited_preset().is_default) {
        out.shape.push_back({ 0.0, 0.0 });
        out.shape.push_back({ 200.0, 0.0 });
        out.shape.push_back({ 200.0, 200.0 });
        out.shape.push_back({ 0.0, 200.0 });
        out.height = 200.0;
        return out;
    }
    const DynamicPrintConfig cfg = im.bundle.full_config();
    for (const Point& p : get_bed_shape(cfg))
        out.shape.push_back({ unscaled<double>(p.x()), unscaled<double>(p.y()) });
    out.height = cfg.opt_float("printable_height");
    return out;
}

std::string Session::option(const std::string& key) const
{
    Impl& im = *m_impl;
    if (const PresetCollection* c = im.owner_of(key)) {
        if (const ConfigOption* opt = c->get_edited_preset().config.option(key))
            return opt->serialize();
    }
    return std::string();
}

bool Session::set_option(const std::string& key, const std::string& value)
{
    Impl&             im = *m_impl;
    PresetCollection* c  = im.owner_of(key);
    if (c == nullptr)
        return false;
    try {
        c->get_edited_preset().config.set_deserialize_strict(key, value);
    } catch (const std::exception&) {
        return false;
    }
    im.sliced = false;
    return true;
}

std::vector<std::string> Session::modified_options(PresetKind kind) const
{
    return m_impl->collection(kind).current_dirty_options();
}

void Session::discard_modified_options(PresetKind kind)
{
    m_impl->collection(kind).discard_current_changes();
    m_impl->sliced = false;
}

bool Session::save_preset_as(PresetKind kind, const std::string& name)
{
    if (name.empty())
        return false;
    PresetCollection& c = m_impl->collection(kind);
    // Refuse to overwrite a preset the collection considers non-editable, matching
    // save_current_preset's own early return; ask up front so the caller gets a bool.
    if (const Preset* existing = c.find_preset(name, false); existing != nullptr && ! existing->can_overwrite())
        return false;
    c.save_current_preset(name, /*detach=*/false, /*save_to_project=*/false, nullptr);
    m_impl->sliced = false;
    return true;
}

bool Session::delete_preset(PresetKind kind, const std::string& name)
{
    PresetCollection& c = m_impl->collection(kind);
    const Preset* p = c.find_preset(name, false);
    if (p == nullptr || ! p->is_user())
        return false;
    const bool ok = c.delete_preset(name, /*force=*/false);
    if (ok)
        m_impl->sliced = false;
    return ok;
}

std::string Session::preset_file(PresetKind kind, const std::string& name) const
{
    const Preset* p = m_impl->collection(kind).find_preset(name, false);
    return p != nullptr ? p->file : std::string();
}

static const char* type_name(ConfigOptionType type)
{
    switch (ConfigOptionType(int(type) & ~int(coVectorType))) {
    case coFloat:          return "float";
    case coInt:            return "int";
    case coString:         return "string";
    case coPercent:        return "percent";
    case coFloatOrPercent: return "float_or_percent";
    case coPoint:          return "point";
    case coBool:           return "bool";
    case coEnum:           return "enum";
    default:               return "other";
    }
}

std::string Session::option_definitions_json()
{
    using nlohmann::json;
    auto kind_of = [](const std::string& key) -> const char* {
        auto contains = [&key](const std::vector<std::string>& keys) {
            return std::find(keys.begin(), keys.end(), key) != keys.end();
        };
        if (contains(Preset::print_options()))    return "process";
        if (contains(Preset::filament_options())) return "filament";
        if (contains(Preset::printer_options()))  return "printer";
        return "other";
    };

    json out = json::array();
    for (const auto& [key, def] : print_config_def.options) {
        json j;
        j["key"]      = key;
        j["kind"]     = kind_of(key);
        j["type"]     = type_name(def.type);
        j["vector"]   = (def.type & coVectorType) != 0;
        j["nullable"] = def.nullable;
        j["readonly"] = def.readonly;
        j["label"]    = def.label;
        j["fullLabel"] = def.full_label;
        j["category"] = def.category;
        j["tooltip"]  = def.tooltip;
        j["unit"]     = def.sidetext;
        j["mode"]     = int(def.mode);
        if (def.min != -FLT_MAX) j["min"] = def.min;
        if (def.max !=  FLT_MAX) j["max"] = def.max;
        if (def.default_value)   j["default"] = def.default_value->serialize();
        if (! def.enum_values.empty()) {
            j["enumValues"] = def.enum_values;
            j["enumLabels"] = def.enum_labels;
        }
        out.push_back(std::move(j));
    }
    return out.dump();
}

std::vector<ObjectInfo> Session::import(const std::string& path)
{
    Impl& im = *m_impl;
    DynamicPrintConfig        project_config;
    ConfigSubstitutionContext substitutions(ForwardCompatibilitySubstitutionRule::Enable);
    Model loaded = Model::read_from_file(path, &project_config, &substitutions,
                                         LoadStrategy::LoadModel | LoadStrategy::LoadConfig | LoadStrategy::AddDefaultInstances);
    if (loaded.objects.empty())
        throw std::runtime_error("No objects found in " + path);

    const BoundingBoxf      bed = im.bed_bbox();
    const Vec2d             center = bed.defined ? bed.center() : Vec2d(0., 0.);
    std::vector<ObjectInfo> out;
    for (const ModelObject* src : loaded.objects) {
        ModelObject* obj = im.model.add_object(*src);
        if (obj->instances.empty())
            obj->add_instance();
        obj->center_around_origin(false);
        obj->ensure_on_bed();
        ModelInstance* inst = obj->instances.front();
        inst->set_offset(Vec3d(center.x(), center.y(), inst->get_offset().z()));
        obj->invalidate_bounding_box();
        out.push_back(im.info(*obj));
    }
    im.sliced = false;
    return out;
}

std::vector<ObjectInfo> Session::objects() const
{
    std::vector<ObjectInfo> out;
    for (const ModelObject* o : m_impl->model.objects)
        out.push_back(m_impl->info(*o));
    return out;
}

bool Session::remove_object(unsigned long id)
{
    Impl& im = *m_impl;
    for (size_t i = 0; i < im.model.objects.size(); ++ i)
        if (im.model.objects[i]->id().id == id) {
            im.model.delete_object(i);
            im.sliced = false;
            return true;
        }
    return false;
}

bool Session::set_transform(unsigned long id, const Vec3& position, const Vec3& rotation, const Vec3& scale)
{
    Impl&        im  = *m_impl;
    ModelObject* obj = im.find_object(id);
    if (obj == nullptr || obj->instances.empty())
        return false;
    ModelInstance* inst = obj->instances.front();
    inst->set_offset(Vec3d(position[0], position[1], position[2]));
    inst->set_rotation(Vec3d(rotation[0], rotation[1], rotation[2]));
    inst->set_scaling_factor(Vec3d(scale[0], scale[1], scale[2]));
    obj->invalidate_bounding_box();
    im.sliced = false;
    return true;
}

void Session::clear()
{
    m_impl->model.clear_objects();
    m_impl->sliced = false;
}

void Session::arrange()
{
    Impl&                    im  = *m_impl;
    const DynamicPrintConfig cfg = im.bundle.full_config();
    ArrangeParams            params(scaled(min_object_distance(cfg)));
    params.printable_height = float(cfg.opt_float("printable_height"));
    arrange_objects(im.model, BoundingBox(get_bed_shape(cfg)), params);
    for (ModelObject* o : im.model.objects)
        o->invalidate_bounding_box();
    im.sliced = false;
}

SliceResult Session::slice(const ProgressFn& on_progress)
{
    Impl&       im = *m_impl;
    SliceResult result;
    im.sliced   = false;
    im.exported = false;

    std::vector<SliceWarning> warnings;
    im.print.restart();
    im.print.set_status_callback([&warnings, &on_progress](const PrintBase::SlicingStatus& s) {
        if (s.warning_step != -1) {
            if (! s.text.empty())
                warnings.push_back({ s.text, s.warning_level != PrintStateBase::WarningLevel::NON_CRITICAL });
        } else if (s.percent >= 0 && on_progress) {
            on_progress(Progress{ s.percent, s.text });
        }
    });

    try {
        im.print.apply(im.model, im.bundle.full_config());
        std::vector<StringObjectException> validation_warnings;
        const StringObjectException        err = im.print.validate(&validation_warnings);
        for (const StringObjectException& w : validation_warnings)
            warnings.push_back({ w.string, false });
        if (! err.string.empty()) {
            result.outcome = SliceOutcome::Failed;
            result.error   = err.string;
        } else {
            im.print.process();
            result.outcome = SliceOutcome::Finished;
            im.sliced      = true;
        }
    } catch (const CanceledException&) {
        result.outcome = SliceOutcome::Cancelled;
    } catch (const std::exception& e) {
        result.outcome = SliceOutcome::Failed;
        result.error   = e.what();
    }

    im.print.set_status_silent();
    result.warnings = std::move(warnings);
    return result;
}

void Session::cancel()
{
    m_impl->print.cancel();
}

bool Session::is_sliced() const
{
    return m_impl->sliced;
}

std::string Session::export_gcode(const std::string& path)
{
    Impl& im = *m_impl;
    if (! im.sliced)
        throw std::runtime_error("The print is not sliced");
    const std::string written = im.print.export_gcode(path, &im.gcode_result, nullptr);
    im.exported = true;
    return written;
}

SliceStatistics Session::statistics() const
{
    const Impl&     im = *m_impl;
    SliceStatistics out;
    if (! im.exported)
        return out;
    const PrintEstimatedStatistics& stats = im.gcode_result.print_statistics;
    out.print_time_s = stats.modes[static_cast<size_t>(PrintEstimatedStatistics::ETimeMode::Normal)].time;
    for (const auto& [extruder, volume] : stats.total_volumes_per_extruder) {
        out.filament_mm3 += volume;
        if (extruder < im.gcode_result.filament_densities.size()) {
            // density is g/cm3, volume mm3
            const double grams = volume * im.gcode_result.filament_densities[extruder] * 0.001;
            out.filament_g += grams;
            if (extruder < im.gcode_result.filament_costs.size())
                out.filament_cost += grams * 0.001 * im.gcode_result.filament_costs[extruder];
        }
    }
    for (const PrintObject* po : im.print.objects())
        out.layer_count = std::max<unsigned long>(out.layer_count, static_cast<unsigned long>(po->layer_count()));
    return out;
}

MeshData Session::mesh(unsigned long id) const
{
    MeshData           out;
    const ModelObject* obj = m_impl->find_object(id);
    if (obj == nullptr)
        return out;

    // ModelObject::mesh() is the object's volumes placed by every instance, so it is
    // already in world space.
    const TriangleMesh mesh = obj->mesh();

    const indexed_triangle_set& its = mesh.its;
    out.triangles = static_cast<unsigned long>(its.indices.size());
    out.positions.reserve(its.indices.size() * 9);
    out.normals.reserve(its.indices.size() * 9);
    for (const stl_triangle_vertex_indices& face : its.indices) {
        const Vec3f& a = its.vertices[face(0)];
        const Vec3f& b = its.vertices[face(1)];
        const Vec3f& c = its.vertices[face(2)];
        Vec3f        n = (b - a).cross(c - a);
        const float  len = n.norm();
        n = len > 0.f ? Vec3f(n / len) : Vec3f(0.f, 0.f, 1.f);
        for (const Vec3f* v : { &a, &b, &c }) {
            out.positions.insert(out.positions.end(), { v->x(), v->y(), v->z() });
            out.normals.insert(out.normals.end(), { n.x(), n.y(), n.z() });
        }
    }
    return out;
}

static PreviewRole preview_role(ExtrusionRole role)
{
    switch (role) {
    case erPerimeter:                return PreviewRole::Perimeter;
    case erExternalPerimeter:        return PreviewRole::ExternalPerimeter;
    case erOverhangPerimeter:        return PreviewRole::OverhangPerimeter;
    case erInternalInfill:           return PreviewRole::InternalInfill;
    case erSolidInfill:              return PreviewRole::SolidInfill;
    case erTopSolidInfill:           return PreviewRole::TopSolidInfill;
    case erBottomSurface:            return PreviewRole::BottomSurface;
    case erIroning:                  return PreviewRole::Ironing;
    case erBridgeInfill:             return PreviewRole::BridgeInfill;
    case erInternalBridgeInfill:     return PreviewRole::InternalBridgeInfill;
    case erGapFill:                  return PreviewRole::GapFill;
    case erSkirt:                    return PreviewRole::Skirt;
    case erBrim:                     return PreviewRole::Brim;
    case erSupportMaterial:          return PreviewRole::Support;
    case erSupportMaterialInterface: return PreviewRole::SupportInterface;
    case erSupportTransition:        return PreviewRole::SupportTransition;
    case erWipeTower:                return PreviewRole::WipeTower;
    case erCustom:                   return PreviewRole::Custom;
    case erMixed:                    return PreviewRole::Mixed;
    default:                         return PreviewRole::None;
    }
}

static PreviewMoveType preview_move_type(EMoveType type)
{
    switch (type) {
    case EMoveType::Retract:      return PreviewMoveType::Retract;
    case EMoveType::Unretract:    return PreviewMoveType::Unretract;
    case EMoveType::Seam:         return PreviewMoveType::Seam;
    case EMoveType::Tool_change:  return PreviewMoveType::ToolChange;
    case EMoveType::Color_change: return PreviewMoveType::ColorChange;
    case EMoveType::Pause_Print:  return PreviewMoveType::PausePrint;
    case EMoveType::Custom_GCode: return PreviewMoveType::CustomGCode;
    case EMoveType::Travel:       return PreviewMoveType::Travel;
    case EMoveType::Wipe:         return PreviewMoveType::Wipe;
    case EMoveType::Extrude:      return PreviewMoveType::Extrude;
    default:                      return PreviewMoveType::Noop;
    }
}

// "#RRGGBB" or "#RRGGBBAA" to RGBA floats; anything else is opaque grey.
static std::array<float, 4> parse_color(const std::string& text)
{
    std::array<float, 4> rgba = { 0.5f, 0.5f, 0.5f, 1.f };
    if ((text.size() == 7 || text.size() == 9) && text[0] == '#') {
        auto hex = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        };
        for (size_t i = 0; i < (text.size() - 1) / 2; ++ i) {
            const int hi = hex(text[1 + 2 * i]), lo = hex(text[2 + 2 * i]);
            if (hi < 0 || lo < 0)
                return { 0.5f, 0.5f, 0.5f, 1.f };
            rgba[i] = float(hi * 16 + lo) / 255.f;
        }
    }
    return rgba;
}

PreviewData Session::preview() const
{
    const Impl& im = *m_impl;
    PreviewData out;
    if (! im.exported)
        return out;

    const GCodeProcessorResult& result = im.gcode_result;
    out.print_time_s = result.print_statistics.modes[static_cast<size_t>(PrintEstimatedStatistics::ETimeMode::Normal)].time;
    for (const std::string& color : result.extruder_colors)
        out.tool_colors.push_back(parse_color(color));

    out.vertices.reserve(result.moves.size());
    for (const GCodeProcessorResult::MoveVertex& move : result.moves) {
        PreviewVertex v;
        v.position[0]     = move.position.x();
        v.position[1]     = move.position.y();
        v.position[2]     = move.position.z();
        v.width           = move.width;
        v.height          = move.height;
        v.feedrate        = move.feedrate;
        v.fan_speed       = move.fan_speed;
        v.temperature     = move.temperature;
        v.volumetric_rate = move.volumetric_rate();
        v.time            = move.time[static_cast<size_t>(PrintEstimatedStatistics::ETimeMode::Normal)];
        v.layer_id        = move.layer_id;
        v.extruder_id     = move.extruder_id;
        v.color_id        = move.cp_color_id;
        v.role            = preview_role(move.extrusion_role);
        v.type            = preview_move_type(move.type);
        out.vertices.push_back(v);

        if (move.type == EMoveType::Extrude) {
            if (out.layer_zs.size() <= move.layer_id)
                out.layer_zs.resize(move.layer_id + 1, 0.f);
            out.layer_zs[move.layer_id] = std::max(out.layer_zs[move.layer_id], move.position.z());
        }
    }
    return out;
}

}} // namespace Slic3r::Mobile
