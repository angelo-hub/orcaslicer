#pragma once

// Names of the on-disk credential files inside the config dir. Header-only so the plugin audit
// hook can deny them without pulling in the cloud agent.
namespace Slic3r::secret_constants {
    // Encrypted refresh-token fallback file, written when wxSecretStore is unavailable.
    // Also seeded into PluginAuditManager's denied-filename registry (install_hook), which
    // additionally covers the ".tmp" staging file the token is written to before its atomic
    // rename, so plugins can read neither.
    constexpr const char* USER_SECRET_FILENAME = "orca_refresh_token.sec";
} // namespace Slic3r::secret_constants
