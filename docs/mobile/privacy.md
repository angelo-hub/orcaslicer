# Orca Mobile privacy policy

Orca Mobile is an unofficial iOS port of OrcaSlicer, built by OrcaSlicer contributors. It has no analytics, advertising or crash reporting, and its developers run no servers that receive your data.

## What stays on your device

Your models, projects, presets, sliced G-code and printer addresses are stored in the app's own storage on your device. They leave it only when you send them somewhere yourself.

## What the app sends, and where

- **Your printers.** When you add a printer, the app connects to the address you enter, on your local network or wherever you point it, to upload G-code and show print status. It talks only to that printer (Moonraker or OctoPrint).
- **Printer profiles.** The app downloads the OrcaSlicer printer, filament and process profiles from GitHub (raw.githubusercontent.com and api.github.com). These requests carry no account information.
- **OrcaSlicer Cloud, if you sign in.** Signing in is optional. If you do, the app sends your sign-in to auth.orcaslicer.com and syncs your presets with api.orcaslicer.com, the same service the desktop OrcaSlicer uses. That service is run by the OrcaSlicer project, not by this app's developers, and its own terms apply. Signing out removes the account's token from the device; to delete the account, use cloud.orcaslicer.com.

## Contact

Questions or requests: open an issue at https://github.com/angelo-hub/orcaslicer/issues.
