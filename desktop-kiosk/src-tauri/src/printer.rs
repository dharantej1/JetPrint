use std::collections::HashMap;
use std::sync::Mutex;

use printers::common::base::job::PrinterJobOptions;
use printers::{get_default_printer, get_printer_by_name, get_printers};

use crate::models::{ConfiguredPrinter, JobFile, PrinterInfo, PrinterPoolType};

static POOL_COUNTERS: Mutex<Option<HashMap<PrinterPoolType, usize>>> = Mutex::new(None);

pub fn get_next_round_robin_index(pool: PrinterPoolType, count: usize) -> usize {
    if count <= 1 {
        return 0;
    }
    let mut guard = POOL_COUNTERS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let counter = map.entry(pool).or_insert(0);
    let idx = *counter % count;
    *counter = (*counter + 1) % 1_000_000;
    idx
}

#[cfg(test)]
pub fn reset_round_robin_counters() {
    let mut guard = POOL_COUNTERS.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(HashMap::new());
}

/// Routes a job file to the appropriate printer based on color and paper size requirements,
/// matching to printer pools with round-robin load balancing and graceful fallback.
pub fn route_file_to_printer(
    file: &JobFile,
    job_color: bool,
    configured_printers: &[ConfiguredPrinter],
    default_printer: Option<&str>,
) -> Option<String> {
    // If file already has an assigned printer specified, use it
    if let Some(ref assigned) = file.assigned_printer {
        let trimmed = assigned.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let enabled: Vec<&ConfiguredPrinter> =
        configured_printers.iter().filter(|p| p.enabled).collect();
    if enabled.is_empty() {
        return default_printer
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
    }

    let paper_size = file
        .settings
        .as_ref()
        .and_then(|s| s.paper_size.as_deref())
        .map(str::trim)
        .unwrap_or("A4");

    let is_large_format = match paper_size.to_uppercase().as_str() {
        "A3" | "A2" | "A1" | "A0" | "LEGAL" | "TABLOID" => true,
        _ => false,
    };

    let is_color = file.settings.as_ref().map(|s| s.color).unwrap_or(job_color);

    // Determine target pool based on specifications
    let target_pool = if is_large_format {
        PrinterPoolType::LargeFormat
    } else if is_color {
        PrinterPoolType::Color
    } else {
        PrinterPoolType::Bw
    };

    // 1. Try to find enabled printers in target_pool
    let pool_printers: Vec<&ConfiguredPrinter> = enabled
        .iter()
        .copied()
        .filter(|p| p.pool == target_pool)
        .collect();

    if !pool_printers.is_empty() {
        let idx = get_next_round_robin_index(target_pool, pool_printers.len());
        return Some(pool_printers[idx].name.clone());
    }

    // 2. Fallback check: capability matching if pool didn't have any printers
    let cap_target = match target_pool {
        PrinterPoolType::LargeFormat => "large_format",
        PrinterPoolType::Color => "color",
        PrinterPoolType::Bw => "bw",
        PrinterPoolType::Default => "default",
    };
    let cap_printers: Vec<&ConfiguredPrinter> = enabled
        .iter()
        .copied()
        .filter(|p| {
            p.capabilities.iter().any(|c| {
                let cl = c.to_lowercase();
                if cap_target == "large_format" {
                    cl == "large_format" || cl == "a3" || cl == "legal"
                } else {
                    cl == cap_target
                }
            })
        })
        .collect();

    if !cap_printers.is_empty() {
        let idx = get_next_round_robin_index(target_pool, cap_printers.len());
        return Some(cap_printers[idx].name.clone());
    }

    // 3. Fallback to default pool
    let default_pool_printers: Vec<&ConfiguredPrinter> = enabled
        .iter()
        .copied()
        .filter(|p| p.pool == PrinterPoolType::Default)
        .collect();

    if !default_pool_printers.is_empty() {
        let idx = get_next_round_robin_index(PrinterPoolType::Default, default_pool_printers.len());
        return Some(default_pool_printers[idx].name.clone());
    }

    // 4. Fallback to printer marked is_default
    if let Some(def_p) = enabled.iter().find(|p| p.is_default) {
        return Some(def_p.name.clone());
    }

    // 5. Fallback to default_printer from config
    if let Some(def_name) = default_printer.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(def_name.to_string());
    }

    // 6. Fallback to any enabled printer
    enabled.first().map(|p| p.name.clone())
}

/// Prints all files in a job using pooled routing per file.
/// For each file: matches color/paperSize to pool with round-robin, checks overrides,
/// falls back to default printer or OS default, and dispatches to the spooler.
pub fn print_job_files_pooled(
    files: &[JobFile],
    copies: u32,
    color: bool,
    configured_printers: &[ConfiguredPrinter],
    default_printer: Option<&str>,
    supported_paper_sizes: Option<&[String]>,
    file_printer_overrides: Option<&std::collections::HashMap<String, String>>,
) -> Result<Vec<(String, String)>, String> {
    if files.is_empty() {
        return Err("Print job has no files".to_string());
    }

    let mut printed_assignments = Vec::with_capacity(files.len());

    for file in files {
        let path = std::path::Path::new(&file.local_path);
        if !path.exists() {
            return Err(format!(
                "Downloaded file missing on disk: {}",
                file.filename
            ));
        }

        // Determine destination printer:
        // 1. Explicit override map
        // 2. Per-file assigned_printer
        // 3. Smart routing (route_file_to_printer)
        let resolved_printer_name = file_printer_overrides
            .and_then(|ov| ov.get(&file.file_id).cloned())
            .or_else(|| route_file_to_printer(file, color, configured_printers, default_printer))
            .or_else(|| default_printer.map(str::to_string));

        let printer = match resolved_printer_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(name) => get_printer_by_name(name)
                .ok_or_else(|| format!("Printer '{name}' not found on system"))?,
            None => get_default_printer()
                .ok_or_else(|| "No default system printer found".to_string())?,
        };

        let target_name = printer.name.clone();

        let owned_props = build_file_print_properties(file, copies, color, supported_paper_sizes);
        let raw_properties: Vec<(&str, &str)> = owned_props
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let options = PrinterJobOptions {
            name: Some(file.filename.as_str()),
            raw_properties: &raw_properties,
            ..PrinterJobOptions::none()
        };

        printer
            .print_file(&file.local_path, options)
            .map_err(|e| {
                format!(
                    "Failed to print '{}' to '{}': {e:?}",
                    file.filename, target_name
                )
            })?;

        printed_assignments.push((file.file_id.clone(), target_name));
    }

    Ok(printed_assignments)
}

pub fn print_test_page(printer_name: &str) -> Result<String, String> {
    let printer = match get_printer_by_name(printer_name) {
        Some(p) => p,
        None => return Err(format!("Printer '{printer_name}' not found")),
    };

    let temp_dir = std::env::temp_dir();
    let test_file_path = temp_dir.join(format!("jetprint_test_page_{}.txt", uuid::Uuid::new_v4()));
    let test_content = format!(
        "JetPrint Test Page\nPrinter: {}\nDate: {}\nStatus: OK\n",
        printer_name,
        chrono::Local::now().to_rfc2822()
    );
    std::fs::write(&test_file_path, &test_content)
        .map_err(|e| format!("Failed to create test page file: {e}"))?;

    let options = PrinterJobOptions {
        name: Some("JetPrint Test Page"),
        ..PrinterJobOptions::none()
    };
    let result = printer.print_file(test_file_path.to_str().unwrap_or(""), options);
    let _ = std::fs::remove_file(&test_file_path);
    result.map_err(|e| format!("Failed to print test page: {e:?}"))?;
    Ok(format!("Test page sent to '{printer_name}' successfully"))
}

/// Lists all printers recognized by the operating system.
pub fn list_system_printers() -> Vec<PrinterInfo> {
    get_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            name: p.name,
            system_name: p.system_name,
            driver_name: p.driver_name,
            is_default: p.is_default,
            state: format!("{:?}", p.state),
        })
        .collect()
}

/// Computes CUPS/spooler raw properties for a single file using its per-file settings
/// (falling back to job-level `default_copies` and `default_color` when absent).
pub fn build_file_print_properties(
    file: &JobFile,
    default_copies: u32,
    default_color: bool,
    supported_paper_sizes: Option<&[String]>,
) -> Vec<(&'static str, String)> {
    let (copies, color, duplex, orientation, pages_per_sheet, page_range, print_ready, paper_size) =
        match &file.settings {
            Some(s) => (
                s.copies.max(1),
                s.color,
                s.duplex.as_str(),
                s.orientation.as_str(),
                s.pages_per_sheet.max(1),
                s.page_range.trim(),
                s.print_ready,
                s.paper_size.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            ),
            None => (
                default_copies.max(1),
                default_color,
                "1-sided",
                "portrait",
                1,
                "all",
                false,
                None,
            ),
        };

    let chosen_paper_size = paper_size
        .or_else(|| {
            supported_paper_sizes
                .and_then(|sizes| sizes.first())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("A4");

    let is_landscape = orientation.eq_ignore_ascii_case("landscape");

    let mut props = vec![
        ("copies", copies.to_string()),
        (
            "ColorModel",
            if color { "Color" } else { "Monochrome" }.to_string(),
        ),
        (
            "sides",
            if duplex == "2-sided" {
                if is_landscape {
                    "two-sided-short-edge"
                } else {
                    "two-sided-long-edge"
                }
            } else {
                "one-sided"
            }
            .to_string(),
        ),
        (
            "orientation-requested",
            if is_landscape { "4" } else { "3" }.to_string(),
        ),
        ("fit-to-page", "true".to_string()),
        ("fitplot", "true".to_string()),
        ("print-scaling", "fit".to_string()),
        ("job-sheets", "none,none".to_string()),
        ("media", chosen_paper_size.to_string()),
        ("PageSize", chosen_paper_size.to_string()),
    ];

    if is_landscape {
        props.push(("landscape", "true".to_string()));
    }

    if !print_ready {
        if pages_per_sheet > 1 {
            props.push(("number-up", pages_per_sheet.to_string()));
        }
        if !page_range.is_empty() && !page_range.eq_ignore_ascii_case("all") {
            props.push(("page-ranges", page_range.to_string()));
        }
    }

    props
}

/// Prints all files in a job to the configured printer (or OS default printer).
pub fn print_job_files(
    printer_name: Option<&str>,
    files: &[JobFile],
    copies: u32,
    color: bool,
    supported_paper_sizes: Option<&[String]>,
) -> Result<(), String> {
    if files.is_empty() {
        return Err("Print job has no files".to_string());
    }

    let printer = match printer_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(name) => get_printer_by_name(name)
            .ok_or_else(|| format!("Configured printer '{name}' not found"))?,
        None => get_default_printer()
            .ok_or_else(|| "No default system printer found".to_string())?,
    };

    for file in files {
        let path = std::path::Path::new(&file.local_path);
        if !path.exists() {
            return Err(format!(
                "Downloaded file missing on disk: {}",
                file.filename
            ));
        }

        let owned_props =
            build_file_print_properties(file, copies, color, supported_paper_sizes);
        let raw_properties: Vec<(&str, &str)> = owned_props
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let options = PrinterJobOptions {
            name: Some(file.filename.as_str()),
            raw_properties: &raw_properties,
            ..PrinterJobOptions::none()
        };

        printer
            .print_file(&file.local_path, options)
            .map_err(|e| format!("Failed to print '{}': {e:?}", file.filename))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FilePrintSettings;

    #[test]
    fn builds_per_file_print_properties_and_falls_back_to_job_defaults() {
        let file_with_settings = JobFile {
            file_id: "f1".to_string(),
            filename: "slides.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/slides.pdf".to_string(),
            pages: 6,
            settings: Some(FilePrintSettings {
                copies: 3,
                color: true,
                duplex: "2-sided".to_string(),
                orientation: "landscape".to_string(),
                pages_per_sheet: 4,
                page_range: "1-4,6".to_string(),
                print_ready: false,
                paper_size: Some("A3".to_string()),
            }),
            assigned_printer: None,
        };

        let props = build_file_print_properties(&file_with_settings, 1, false, None);
        assert!(props.contains(&("copies", "3".to_string())));
        assert!(props.contains(&("ColorModel", "Color".to_string())));
        assert!(props.contains(&("sides", "two-sided-short-edge".to_string())));
        assert!(props.contains(&("orientation-requested", "4".to_string())));
        assert!(props.contains(&("landscape", "true".to_string())));
        assert!(props.contains(&("fit-to-page", "true".to_string())));
        assert!(props.contains(&("fitplot", "true".to_string())));
        assert!(props.contains(&("print-scaling", "fit".to_string())));
        assert!(props.contains(&("media", "A3".to_string())));
        assert!(props.contains(&("PageSize", "A3".to_string())));
        assert!(props.contains(&("number-up", "4".to_string())));
        assert!(props.contains(&("page-ranges", "1-4,6".to_string())));

        let file_without_settings = JobFile {
            file_id: "f2".to_string(),
            filename: "doc.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/doc.pdf".to_string(),
            pages: 2,
            settings: None,
            assigned_printer: None,
        };
        let supported = vec!["Letter".to_string(), "Legal".to_string()];
        let fallback_props = build_file_print_properties(&file_without_settings, 2, false, Some(&supported));
        assert!(fallback_props.contains(&("copies", "2".to_string())));
        assert!(fallback_props.contains(&("ColorModel", "Monochrome".to_string())));
        assert!(fallback_props.contains(&("sides", "one-sided".to_string())));
        assert!(fallback_props.contains(&("orientation-requested", "3".to_string())));
        assert!(fallback_props.contains(&("media", "Letter".to_string())));
        assert!(fallback_props.contains(&("PageSize", "Letter".to_string())));
        assert!(!fallback_props.contains(&("landscape", "true".to_string())));
        assert!(fallback_props.contains(&("fit-to-page", "true".to_string())));
        assert!(fallback_props.contains(&("fitplot", "true".to_string())));
        assert!(fallback_props.contains(&("print-scaling", "fit".to_string())));
        assert!(!fallback_props.iter().any(|(k, _)| *k == "number-up"));
        assert!(!fallback_props.iter().any(|(k, _)| *k == "page-ranges"));

        // Fallback when supported list is empty or None -> A4
        let default_a4_props = build_file_print_properties(&file_without_settings, 1, false, None);
        assert!(default_a4_props.contains(&("media", "A4".to_string())));
        assert!(default_a4_props.contains(&("PageSize", "A4".to_string())));
    }

    #[test]
    fn print_ready_skips_number_up_and_page_ranges() {
        let file = JobFile {
            file_id: "f3".to_string(),
            filename: "precomposed.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/precomposed.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                copies: 1,
                color: false,
                duplex: "1-sided".to_string(),
                orientation: "portrait".to_string(),
                pages_per_sheet: 2,
                page_range: "all".to_string(),
                print_ready: true,
                paper_size: Some("Legal".to_string()),
            }),
            assigned_printer: None,
        };
        let props = build_file_print_properties(&file, 1, false, None);
        assert!(props.contains(&("orientation-requested", "3".to_string())));
        assert!(props.contains(&("media", "Legal".to_string())));
        assert!(props.contains(&("PageSize", "Legal".to_string())));
        assert!(!props.iter().any(|(k, _)| *k == "number-up"));
        assert!(!props.iter().any(|(k, _)| *k == "page-ranges"));
    }

    #[test]
    fn smart_routing_routes_bw_color_and_large_format() {
        reset_round_robin_counters();

        let printers = vec![
            ConfiguredPrinter {
                id: "p1".to_string(),
                name: "LaserJet-BW-1".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["bw".to_string(), "a4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p2".to_string(),
                name: "LaserJet-BW-2".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["bw".to_string(), "a4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p3".to_string(),
                name: "Epson-Color-1".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Color,
                capabilities: vec!["color".to_string(), "a4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p4".to_string(),
                name: "Plotter-Large-1".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::LargeFormat,
                capabilities: vec!["a3".to_string(), "legal".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p5".to_string(),
                name: "Default-Fallback".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Default,
                capabilities: vec!["bw".to_string(), "a4".to_string()],
                is_default: true,
            },
        ];

        // 1. Color file -> routes to Epson-Color-1
        let color_file = JobFile {
            file_id: "f-col".to_string(),
            filename: "photo.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/photo.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: true,
                ..Default::default()
            }),
            assigned_printer: None,
        };
        let routed_color = route_file_to_printer(&color_file, false, &printers, None);
        assert_eq!(routed_color.as_deref(), Some("Epson-Color-1"));

        // 2. Large format file -> routes to Plotter-Large-1
        let a3_file = JobFile {
            file_id: "f-a3".to_string(),
            filename: "blueprint.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/blueprint.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                paper_size: Some("A3".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };
        let routed_a3 = route_file_to_printer(&a3_file, false, &printers, None);
        assert_eq!(routed_a3.as_deref(), Some("Plotter-Large-1"));

        // 3. B&W A4 file -> round-robins between BW-1 and BW-2
        let bw_file = JobFile {
            file_id: "f-bw".to_string(),
            filename: "text.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/text.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: false,
                paper_size: Some("A4".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };
        let first_bw = route_file_to_printer(&bw_file, false, &printers, None);
        let second_bw = route_file_to_printer(&bw_file, false, &printers, None);
        let third_bw = route_file_to_printer(&bw_file, false, &printers, None);
        assert_eq!(first_bw.as_deref(), Some("LaserJet-BW-1"));
        assert_eq!(second_bw.as_deref(), Some("LaserJet-BW-2"));
        assert_eq!(third_bw.as_deref(), Some("LaserJet-BW-1"));

        // 4. Per-file explicit assignment overrides pool routing
        let override_file = JobFile {
            file_id: "f-ov".to_string(),
            filename: "special.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/special.pdf".to_string(),
            pages: 1,
            settings: None,
            assigned_printer: Some("Custom-Override-Printer".to_string()),
        };
        let routed_override = route_file_to_printer(&override_file, false, &printers, None);
        assert_eq!(routed_override.as_deref(), Some("Custom-Override-Printer"));

        // 5. Fallback when pool is empty: only Default-Fallback printer available
        let default_only_printers = vec![ConfiguredPrinter {
            id: "p-def".to_string(),
            name: "Default-Only".to_string(),
            nickname: None,
            enabled: true,
            pool: PrinterPoolType::Default,
            capabilities: vec![],
            is_default: true,
        }];
        let routed_fallback = route_file_to_printer(&color_file, true, &default_only_printers, None);
        assert_eq!(routed_fallback.as_deref(), Some("Default-Only"));
    }
}
