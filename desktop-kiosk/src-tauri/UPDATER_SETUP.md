# Tauri Auto-Updater Setup

1. Generate a signing keypair locally:
   ```bash
   npx tauri signer generate -w ~/.tauri/jetprint.key
   ```
2. Copy the generated **public key** into `desktop-kiosk/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
3. Add the following GitHub Repository Secrets in **Settings -> Secrets and variables -> Actions**:
   - `TAURI_SIGNING_PRIVATE_KEY`: contents of `~/.tauri/jetprint.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password chosen during `tauri signer generate`
4. Push a version tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`) to trigger `.github/workflows/release.yml`, which builds Windows, macOS, and Linux binaries and uploads `latest.json` to the GitHub Release.

