use std::fs;
use std::path::PathBuf;
use sha2::{Digest, Sha256};

/// Computes the persistent, deterministic machine ID for the host machine.
/// Format: `jp-<12 lowercase hex characters>`
pub fn get_deterministic_machine_id() -> String {
    let raw = resolve_raw_hardware_id();
    hash_to_machine_id(&raw)
}

/// Hashes any seed string with SHA-256 and produces `jp-<12 hex chars>`.
pub fn hash_to_machine_id(raw_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"jetprint-kiosk:");
    hasher.update(raw_id.trim().to_lowercase().as_bytes());
    let result = hasher.finalize();
    let hex_hash = format!("{:x}", result);
    format!("jp-{}", &hex_hash[..12])
}

fn resolve_raw_hardware_id() -> String {
    // Tier 1a: Native OS hardware machine UID
    // Windows: HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid
    // macOS: gethostuuid (IOPlatformUUID)
    // Linux/BSD/illumos: standard machine-id / hostid
    if let Ok(id) = machine_uid::get() {
        let clean = id.trim().to_lowercase();
        if !clean.is_empty() && clean != "unknown" {
            return clean;
        }
    }

    // Tier 1b: Additional hardware checks for Linux/ARM/Raspberry Pi
    #[cfg(target_os = "linux")]
    {
        if let Some(rpi_serial) = read_rpi_cpuinfo_serial() {
            return rpi_serial;
        }
        if let Ok(dmi_uuid) = fs::read_to_string("/sys/class/dmi/id/product_uuid") {
            let clean = dmi_uuid.trim().to_lowercase();
            if !clean.is_empty() {
                return clean;
            }
        }
        if let Ok(machine_id) = fs::read_to_string("/etc/machine-id") {
            let clean = machine_id.trim().to_lowercase();
            if !clean.is_empty() {
                return clean;
            }
        }
    }

    // Tier 2: Primary network MAC address
    if let Some(mac) = read_first_mac_address() {
        return mac;
    }

    // Tier 3: Persistent OS machine seed stored outside the app install & DB directory
    get_or_create_persistent_seed()
}

#[cfg(target_os = "linux")]
fn read_rpi_cpuinfo_serial() -> Option<String> {
    let content = fs::read_to_string("/proc/cpuinfo").ok()?;
    for line in content.lines() {
        if let Some((key, val)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("Serial") {
                let serial = val.trim().to_lowercase();
                if !serial.is_empty() && serial != "0000000000000000" {
                    return Some(serial);
                }
            }
        }
    }
    None
}

fn read_first_mac_address() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = fs::read_dir("/sys/class/net") {
            for entry in entries.flatten() {
                let iface_name = entry.file_name();
                let iface_str = iface_name.to_string_lossy();
                if iface_str == "lo" {
                    continue;
                }
                let addr_path = entry.path().join("address");
                if let Ok(addr) = fs::read_to_string(addr_path) {
                    let clean = addr.trim().to_lowercase();
                    if !clean.is_empty() && clean != "00:00:00:00:00:00" {
                        return Some(clean);
                    }
                }
            }
        }
    }
    None
}

fn get_persistent_seed_path() -> Option<PathBuf> {
    if let Some(data_dir) = dirs::data_local_dir() {
        return Some(data_dir.join("JetPrint").join(".machine_seed"));
    }
    dirs::home_dir().map(|h| h.join(".jetprint_machine_seed"))
}

fn get_or_create_persistent_seed() -> String {
    if let Some(path) = get_persistent_seed_path() {
        if let Ok(existing) = fs::read_to_string(&path) {
            let clean = existing.trim().to_string();
            if !clean.is_empty() {
                return clean;
            }
        }

        let new_seed = uuid::Uuid::new_v4().simple().to_string();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &new_seed);
        return new_seed;
    }

    uuid::Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_same_machine_id() {
        let id1 = get_deterministic_machine_id();
        let id2 = get_deterministic_machine_id();
        assert_eq!(id1, id2, "Multiple calls must return the identical machine ID");
        assert!(id1.starts_with("jp-"));
        assert_eq!(id1.len(), 15);
    }

    #[test]
    fn test_hash_to_machine_id_format() {
        let res = hash_to_machine_id("test-guid-12345");
        assert!(res.starts_with("jp-"));
        assert_eq!(res.len(), 15);
        let hex_part = &res[3..];
        assert!(hex_part.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_hash_to_machine_id_case_and_whitespace_insensitivity() {
        let res1 = hash_to_machine_id("  8EA3EDDC-BF0F-5240-AC27-1B7AA9084312\n");
        let res2 = hash_to_machine_id("8ea3eddc-bf0f-5240-ac27-1b7aa9084312");
        assert_eq!(res1, res2);
    }

    #[test]
    fn test_hash_to_machine_id_different_seeds() {
        let res1 = hash_to_machine_id("hardware-seed-A");
        let res2 = hash_to_machine_id("hardware-seed-B");
        assert_ne!(res1, res2);
    }
}

