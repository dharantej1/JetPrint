use std::collections::HashMap;
use std::sync::Mutex;

use printers::common::base::job::PrinterJobOptions;
use printers::{get_default_printer, get_printer_by_name, get_printers};

use crate::models::{ConfiguredPrinter, JobFile, PrinterInfo, PrinterPoolType};

static ROUTING_COUNTERS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

pub fn get_next_round_robin_for_key(key: &str, count: usize) -> usize {
    if count <= 1 {
        return 0;
    }
    let mut guard = ROUTING_COUNTERS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let counter = map.entry(key.to_string()).or_insert(0);
    let idx = *counter % count;
    *counter = (*counter + 1) % 1_000_000;
    idx
}

pub fn get_next_round_robin_index(pool: PrinterPoolType, count: usize) -> usize {
    get_next_round_robin_for_key(pool.as_str(), count)
}

#[cfg(test)]
pub fn reset_round_robin_counters() {
    let mut guard = ROUTING_COUNTERS.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(HashMap::new());
}

/// Automatically detects printer capabilities and recommended pool based on printer name / model.
pub fn detect_printer_capabilities(printer_name: &str) -> (Vec<String>, PrinterPoolType) {
    let lower = printer_name.to_lowercase();
    let is_color = lower.contains("color")
        || lower.contains("colour")
        || lower.contains("deskjet")
        || lower.contains("inkjet")
        || lower.contains("l3250")
        || lower.contains("l3150")
        || lower.contains("l3110")
        || lower.contains("ecotank")
        || lower.contains("pixma")
        || lower.contains("photo")
        || lower.contains("pagewide")
        || lower.contains("clx")
        || lower.contains("officejet")
        || lower.contains("stylus")
        || lower.contains("envy")
        || lower.contains("artisan")
        || lower.contains("smart tank");

    let is_large = lower.contains("a3")
        || lower.contains("wide")
        || lower.contains("large")
        || lower.contains("plotter")
        || lower.contains("designjet");

    let is_legal = lower.contains("legal");
    let is_letter = lower.contains("letter");

    let mut caps = vec!["B&W".to_string(), "A4".to_string()];
    if is_color {
        caps.push("Color".to_string());
    }
    if is_large {
        caps.push("A3".to_string());
    }
    if is_legal {
        caps.push("Legal".to_string());
    }
    if is_letter {
        caps.push("Letter".to_string());
    }

    let pool = if is_large {
        PrinterPoolType::LargeFormat
    } else if is_color {
        PrinterPoolType::Color
    } else {
        PrinterPoolType::Bw
    };

    (caps, pool)
}

/// Checks if a printer supports the requested color mode (Color vs B&W).
/// - For Color jobs: matches printers having 'Color' or 'colour' capability.
/// - For B&W jobs: matches printers having 'B&W', 'bw', 'monochrome', or 'black' capability.
/// - Backward compatibility: if no color or B&W capability is specified, falls back to legacy pool field.
pub fn printer_matches_color(p: &ConfiguredPrinter, is_color: bool) -> bool {
    let has_color_cap = p.capabilities.iter().any(|c| {
        let cl = c.trim().to_lowercase();
        cl == "color" || cl == "colour"
    });
    let has_bw_cap = p.capabilities.iter().any(|c| {
        let cl = c.trim().to_lowercase();
        cl == "bw" || cl == "b&w" || cl == "monochrome" || cl == "black"
    });

    if is_color {
        if has_color_cap {
            return true;
        }
        // If neither color nor B&W capability is explicitly declared, check legacy pool
        if !has_bw_cap && p.pool == PrinterPoolType::Color {
            return true;
        }
        false
    } else {
        if has_bw_cap {
            return true;
        }
        // If neither color nor B&W capability is explicitly declared, check legacy pool
        if !has_color_cap
            && (p.pool == PrinterPoolType::Bw
                || p.pool == PrinterPoolType::Default
                || p.pool == PrinterPoolType::LargeFormat)
        {
            return true;
        }
        false
    }
}

/// Checks if a printer supports the requested paper size (e.g. A4, A3, Legal, Letter).
/// - Direct match against explicit capabilities (case-insensitive).
/// - Large format alias: 'large_format' capability matches A3, Legal, etc.
/// - Backward compatibility: if no paper size capabilities are specified, infers from legacy pool
///   (LargeFormat pool matches large formats like A3/Legal; standard pools match A4/Letter).
pub fn printer_matches_paper_size(p: &ConfiguredPrinter, paper_size: &str) -> bool {
    let target = paper_size.trim().to_lowercase();
    let is_large_format = matches!(
        target.as_str(),
        "a3" | "a2" | "a1" | "a0" | "legal" | "tabloid"
    );

    // Direct match against explicit capabilities
    let has_matching_cap = p.capabilities.iter().any(|c| {
        let cl = c.trim().to_lowercase();
        cl == target
            || (cl == "large_format" && is_large_format)
    });
    if has_matching_cap {
        return true;
    }

    // Check if printer specifies ANY paper size capability
    let has_any_size_cap = p.capabilities.iter().any(|c| {
        let cl = c.trim().to_lowercase();
        matches!(
            cl.as_str(),
            "a4" | "a3" | "a2" | "a1" | "a0" | "legal" | "letter" | "tabloid" | "large_format"
        )
    });

    if !has_any_size_cap {
        // Fallback to legacy pool if no paper size capabilities are listed
        if p.pool == PrinterPoolType::LargeFormat {
            return is_large_format;
        } else {
            return !is_large_format;
        }
    }

    false
}

/// Routes a job file to the appropriate printer based on color and paper size requirements,
/// matching via capability-based routing with round-robin load balancing and graceful fallback.
pub fn route_file_to_printer(
    file: &JobFile,
    job_color: bool,
    configured_printers: &[ConfiguredPrinter],
    default_printer: Option<&str>,
) -> Option<String> {
    // 1. If file already has an assigned printer specified, use it
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
        .filter(|s| !s.is_empty())
        .unwrap_or("A4");

    let is_color = file.settings.as_ref().map(|s| s.color).unwrap_or(job_color);

    // 2. Filter enabled printers that match the required color mode
    let color_printers: Vec<&ConfiguredPrinter> = enabled
        .iter()
        .copied()
        .filter(|p| printer_matches_color(p, is_color))
        .collect();

    // 3. Among color-matching printers, filter those supporting the requested paper size
    let exact_printers: Vec<&ConfiguredPrinter> = color_printers
        .iter()
        .copied()
        .filter(|p| printer_matches_paper_size(p, paper_size))
        .collect();

    // Prefer printers that explicitly specify capabilities over those relying on empty legacy fallback
    let explicit_exact: Vec<&ConfiguredPrinter> = exact_printers
        .iter()
        .copied()
        .filter(|p| !p.capabilities.is_empty())
        .collect();
    let target_exact = if !explicit_exact.is_empty() {
        &explicit_exact
    } else {
        &exact_printers
    };

    if !target_exact.is_empty() {
        let printer_set_key = target_exact
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>()
            .join("+");
        let key = format!(
            "{}_{}_{}",
            if is_color { "color" } else { "bw" },
            paper_size.to_lowercase(),
            printer_set_key
        );
        let idx = get_next_round_robin_for_key(&key, target_exact.len());
        return Some(target_exact[idx].name.clone());
    }

    // 4. Graceful fallback: If no printer explicitly matches paper size, fallback to any printer matching color mode
    let explicit_color: Vec<&ConfiguredPrinter> = color_printers
        .iter()
        .copied()
        .filter(|p| !p.capabilities.is_empty())
        .collect();
    let target_color = if !explicit_color.is_empty() {
        &explicit_color
    } else {
        &color_printers
    };

    if !target_color.is_empty() {
        let printer_set_key = target_color
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>()
            .join("+");
        let key = format!(
            "{}_fallback_{}",
            if is_color { "color" } else { "bw" },
            printer_set_key
        );
        let idx = get_next_round_robin_for_key(&key, target_color.len());
        return Some(target_color[idx].name.clone());
    }

    // 5. Fallback to default printer
    if let Some(def_p) = enabled.iter().find(|p| p.is_default) {
        return Some(def_p.name.clone());
    }
    if let Some(def_name) = default_printer.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(p) = enabled.iter().find(|p| p.name == def_name) {
            return Some(p.name.clone());
        }
        return Some(def_name.to_string());
    }

    // 6. Fallback to any enabled printer
    enabled.first().map(|p| p.name.clone())
}

/// Checks whether a job file is a PDF (by extension, MIME type, print_ready flag, or magic bytes).
pub fn is_pdf_file(file: &JobFile) -> bool {
    if file.filename.to_lowercase().ends_with(".pdf")
        || file.local_path.to_lowercase().ends_with(".pdf")
    {
        return true;
    }
    if file.mime_type.eq_ignore_ascii_case("application/pdf") {
        return true;
    }
    if file.settings.as_ref().map(|s| s.print_ready).unwrap_or(false) {
        return true;
    }
    if let Ok(mut f) = std::fs::File::open(&file.local_path) {
        use std::io::Read;
        let mut magic = [0u8; 4];
        if f.read_exact(&mut magic).is_ok() && &magic == b"%PDF" {
            return true;
        }
    }
    false
}

#[cfg(target_os = "macos")]
extern "C" {
    fn macos_print_pdf(
        printer_name: *const std::os::raw::c_char,
        pdf_path: *const std::os::raw::c_char,
        copies: i32,
        is_duplex: i32,
        is_landscape: i32,
        paper_size: *const std::os::raw::c_char,
    ) -> i32;
}

#[cfg(target_os = "macos")]
pub fn try_macos_native_print(
    printer_name: &str,
    pdf_path: &str,
    copies: u32,
    is_duplex: bool,
    is_landscape: bool,
    paper_size: Option<&str>,
) -> bool {
    use std::ffi::CString;

    let c_printer = match CString::new(printer_name) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let c_path = match CString::new(pdf_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let c_paper = paper_size.and_then(|s| CString::new(s).ok());
    let paper_ptr = c_paper.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());

    let res = unsafe {
        macos_print_pdf(
            c_printer.as_ptr(),
            c_path.as_ptr(),
            copies as i32,
            if is_duplex { 1 } else { 0 },
            if is_landscape { 1 } else { 0 },
            paper_ptr,
        )
    };

    if res == 0 {
        eprintln!("[JetPrint Printer] Printed '{pdf_path}' via native macOS PDFKit to '{printer_name}'");
        true
    } else {
        eprintln!("[JetPrint Printer] Native macOS print returned code {res}; falling back to spooler");
        false
    }
}

/// Helper to resolve a system printer, gracefully avoiding Bonjour loopback aliases
/// (e.g. "PrinterName @ Host" when "PrinterName" is locally present).
pub fn resolve_printer_with_alias_handling(name: &str) -> Option<printers::common::base::printer::Printer> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    // If the name is in the format "BaseName @ Hostname", check if the BaseName exists locally first
    if let Some((base, _)) = trimmed.split_once(" @ ") {
        let base_trimmed = base.trim();
        if !base_trimmed.is_empty() {
            if let Some(base_p) = get_printer_by_name(base_trimmed) {
                return Some(base_p);
            }
        }
    }

    // Try finding by exact name
    if let Some(p) = get_printer_by_name(trimmed) {
        return Some(p);
    }

    // Fallback: check if any printer's system_name or base name matches
    let all = get_printers();
    all.into_iter().find(|p| {
        p.name.eq_ignore_ascii_case(trimmed)
            || p.system_name.eq_ignore_ascii_case(trimmed)
            || p.name
                .split_once(" @ ")
                .map(|(b, _)| b.trim().eq_ignore_ascii_case(trimmed))
                .unwrap_or(false)
    })
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
            Some(name) => resolve_printer_with_alias_handling(name)
                .or_else(get_default_printer)
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

        #[cfg(target_os = "macos")]
        let mac_printed = if is_pdf_file(file) {
            let is_duplex = file.settings.as_ref().map(|s| s.duplex.as_str()) == Some("2-sided");
            let is_landscape = file
                .settings
                .as_ref()
                .map(|s| s.orientation.eq_ignore_ascii_case("landscape"))
                .unwrap_or(false);
            let paper_size = file.settings.as_ref().and_then(|s| s.paper_size.as_deref());
            let file_copies = file.settings.as_ref().map(|s| s.copies).unwrap_or(copies);
            try_macos_native_print(
                &target_name,
                &file.local_path,
                file_copies,
                is_duplex,
                is_landscape,
                paper_size,
            )
        } else {
            false
        };

        #[cfg(not(target_os = "macos"))]
        let mac_printed = false;

        let actual_target_name = if mac_printed {
            target_name
        } else {
            let print_res = printer.print_file(&file.local_path, options.clone());
            match print_res {
                Ok(_) => target_name,
                Err(e) => {
                    eprintln!(
                        "[JetPrint Printer] Failed to print '{}' to '{}': {e:?}",
                        file.filename, target_name
                    );
                    // Attempt fallback to default printer if target_name is not already the fallback
                    let fallback_printer = default_printer
                        .and_then(resolve_printer_with_alias_handling)
                        .or_else(get_default_printer)
                        .filter(|p| p.name != target_name);

                    if let Some(fallback) = fallback_printer {
                        let fb_name = fallback.name.clone();
                        eprintln!(
                            "[JetPrint Printer] Retrying print of '{}' with fallback printer '{}'...",
                            file.filename, fb_name
                        );
                        fallback.print_file(&file.local_path, options).map_err(|fb_err| {
                            format!(
                                "Failed to print '{}' to '{}' ({e:?}); fallback to '{}' also failed: {fb_err:?}",
                                file.filename, target_name, fb_name
                            )
                        })?;
                        fb_name
                    } else {
                        return Err(format!(
                            "Failed to print '{}' to '{}': {e:?}",
                            file.filename, target_name
                        ));
                    }
                }
            }
        };

        printed_assignments.push((file.file_id.clone(), actual_target_name));
    }

    Ok(printed_assignments)
}

pub fn print_test_page(printer_name: &str) -> Result<String, String> {
    let printer = match resolve_printer_with_alias_handling(printer_name).or_else(get_default_printer) {
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

/// Lists all printers recognized by the operating system, filtering out ghost loopback aliases.
pub fn list_system_printers() -> Vec<PrinterInfo> {
    let all = get_printers();
    let local_names: std::collections::HashSet<String> = all.iter().map(|p| p.name.clone()).collect();

    all.into_iter()
        .filter(|p| {
            // Filter out Bonjour ghost aliases when base exists locally
            if let Some((base, _)) = p.name.split_once(" @ ") {
                if local_names.contains(base.trim()) {
                    return false;
                }
            }
            true
        })
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
        ("fit-to-page", "true".to_string()),
        ("fitplot", "true".to_string()),
        ("print-scaling", "fit".to_string()),
        ("job-sheets", "none,none".to_string()),
        ("media", chosen_paper_size.to_string()),
        ("PageSize", chosen_paper_size.to_string()),
        ("InputSlot", "Auto".to_string()),
        ("ManualFeed", "False".to_string()),
        ("manual-feed", "false".to_string()),
        ("media-source", "auto".to_string()),
    ];

    if !print_ready {
        if is_landscape {
            props.push(("orientation-requested", "4".to_string()));
            props.push(("landscape", "true".to_string()));
        } else {
            props.push(("orientation-requested", "3".to_string()));
        }
        if pages_per_sheet > 1 {
            props.push(("number-up", pages_per_sheet.to_string()));
        }
        if !page_range.is_empty() && !page_range.eq_ignore_ascii_case("all") {
            props.push(("page-ranges", page_range.to_string()));
        }
    } else {
        props.push(("orientation-requested", "3".to_string()));
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

        #[cfg(target_os = "macos")]
        let mac_printed = if is_pdf_file(file) {
            let is_duplex = file.settings.as_ref().map(|s| s.duplex.as_str()) == Some("2-sided");
            let is_landscape = file
                .settings
                .as_ref()
                .map(|s| s.orientation.eq_ignore_ascii_case("landscape"))
                .unwrap_or(false);
            let paper_size = file.settings.as_ref().and_then(|s| s.paper_size.as_deref());
            let file_copies = file.settings.as_ref().map(|s| s.copies).unwrap_or(copies);
            try_macos_native_print(
                &printer.name,
                &file.local_path,
                file_copies,
                is_duplex,
                is_landscape,
                paper_size,
            )
        } else {
            false
        };

        #[cfg(not(target_os = "macos"))]
        let mac_printed = false;

        if !mac_printed {
            printer
                .print_file(&file.local_path, options)
                .map_err(|e| format!("Failed to print '{}': {e:?}", file.filename))?;
        }
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
        assert!(props.contains(&("InputSlot", "Auto".to_string())));
        assert!(props.contains(&("ManualFeed", "False".to_string())));
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

        let landscape_print_ready = JobFile {
            file_id: "f4".to_string(),
            filename: "landscape_precomposed.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/landscape_precomposed.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                copies: 1,
                color: false,
                duplex: "1-sided".to_string(),
                orientation: "landscape".to_string(),
                pages_per_sheet: 1,
                page_range: "all".to_string(),
                print_ready: true,
                paper_size: Some("A4".to_string()),
            }),
            assigned_printer: None,
        };
        let l_props = build_file_print_properties(&landscape_print_ready, 1, false, None);
        assert!(l_props.contains(&("orientation-requested", "3".to_string())));
        assert!(!l_props.contains(&("landscape", "true".to_string())));
    }

    #[test]
    fn smart_routing_routes_bw_color_and_large_format() {
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
                capabilities: vec![],
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
        assert_ne!(first_bw, second_bw);
        assert_eq!(first_bw, third_bw);
        assert!(first_bw == Some("LaserJet-BW-1".to_string()) || first_bw == Some("LaserJet-BW-2".to_string()));
        assert!(second_bw == Some("LaserJet-BW-1".to_string()) || second_bw == Some("LaserJet-BW-2".to_string()));

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

    #[test]
    fn handles_printer_alias_resolution() {
        // Empty returns None
        assert!(resolve_printer_with_alias_handling("").is_none());
        assert!(resolve_printer_with_alias_handling("   ").is_none());
    }

    #[test]
    fn detects_pdf_files_across_mime_types_and_extensions() {
        let pdf_by_ext = JobFile {
            file_id: "f1".to_string(),
            filename: "doc.pdf".to_string(),
            mime_type: "application/octet-stream".to_string(),
            local_path: "/tmp/nonexistent.pdf".to_string(),
            pages: 1,
            settings: None,
            assigned_printer: None,
        };
        assert!(is_pdf_file(&pdf_by_ext));

        let pdf_by_mime = JobFile {
            file_id: "f2".to_string(),
            filename: "photo.jpg".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/nonexistent.jpg".to_string(),
            pages: 1,
            settings: None,
            assigned_printer: None,
        };
        assert!(is_pdf_file(&pdf_by_mime));

        let pdf_by_print_ready = JobFile {
            file_id: "f3".to_string(),
            filename: "scan.png".to_string(),
            mime_type: "image/png".to_string(),
            local_path: "/tmp/nonexistent.png".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                print_ready: true,
                ..Default::default()
            }),
            assigned_printer: None,
        };
        assert!(is_pdf_file(&pdf_by_print_ready));

        let non_pdf = JobFile {
            file_id: "f4".to_string(),
            filename: "notes.txt".to_string(),
            mime_type: "text/plain".to_string(),
            local_path: "/tmp/nonexistent.txt".to_string(),
            pages: 1,
            settings: None,
            assigned_printer: None,
        };
        assert!(!is_pdf_file(&non_pdf));
    }

    #[test]
    fn test_multi_printer_load_balancing_round_robin() {
        let printers = vec![
            ConfiguredPrinter {
                id: "p1".to_string(),
                name: "Printer-Alpha".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "A4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p2".to_string(),
                name: "Printer-Beta".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "A4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p3".to_string(),
                name: "Printer-Gamma".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "A4".to_string()],
                is_default: false,
            },
        ];

        let file = JobFile {
            file_id: "f-rr".to_string(),
            filename: "invoice.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/invoice.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: false,
                paper_size: Some("A4".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };

        // 6 jobs should round-robin across Alpha, Beta, Gamma cyclically
        let r1 = route_file_to_printer(&file, false, &printers, None).unwrap();
        let r2 = route_file_to_printer(&file, false, &printers, None).unwrap();
        let r3 = route_file_to_printer(&file, false, &printers, None).unwrap();
        let r4 = route_file_to_printer(&file, false, &printers, None).unwrap();
        let r5 = route_file_to_printer(&file, false, &printers, None).unwrap();
        let r6 = route_file_to_printer(&file, false, &printers, None).unwrap();

        let mut first_cycle = vec![r1.as_str(), r2.as_str(), r3.as_str()];
        first_cycle.sort();
        assert_eq!(first_cycle, vec!["Printer-Alpha", "Printer-Beta", "Printer-Gamma"]);
        assert_eq!(r1, r4);
        assert_eq!(r2, r5);
        assert_eq!(r3, r6);
    }

    #[test]
    fn test_dual_capability_printer_routes_both_bw_and_color() {
        let printers = vec![
            ConfiguredPrinter {
                id: "p-mono-dual-test".to_string(),
                name: "DualTest-Mono-Workhorse".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "A4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p-color-dual-test".to_string(),
                name: "DualTest-Color-Multifunction".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Color,
                capabilities: vec!["B&W".to_string(), "Color".to_string(), "A4".to_string()],
                is_default: false,
            },
        ];

        let color_file = JobFile {
            file_id: "f-col".to_string(),
            filename: "flyer.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/flyer.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: true,
                paper_size: Some("A4".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };

        // Color jobs should ONLY route to the dual-capability printer (since mono doesn't support color)
        let col1 = route_file_to_printer(&color_file, true, &printers, None);
        let col2 = route_file_to_printer(&color_file, true, &printers, None);
        assert_eq!(col1.as_deref(), Some("DualTest-Color-Multifunction"));
        assert_eq!(col2.as_deref(), Some("DualTest-Color-Multifunction"));

        let bw_file = JobFile {
            file_id: "f-bw".to_string(),
            filename: "contract.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/contract.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: false,
                paper_size: Some("A4".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };

        // B&W jobs should alternate between both printers
        let bw1 = route_file_to_printer(&bw_file, false, &printers, None).unwrap();
        let bw2 = route_file_to_printer(&bw_file, false, &printers, None).unwrap();
        assert_ne!(bw1, bw2);
        assert!(bw1 == "DualTest-Mono-Workhorse" || bw1 == "DualTest-Color-Multifunction");
        assert!(bw2 == "DualTest-Mono-Workhorse" || bw2 == "DualTest-Color-Multifunction");
    }

    #[test]
    fn test_paper_size_routing_and_graceful_fallback() {
        let printers = vec![
            ConfiguredPrinter {
                id: "p-a4".to_string(),
                name: "Printer-A4".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "A4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p-a3".to_string(),
                name: "Printer-A3".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::LargeFormat,
                capabilities: vec!["B&W".to_string(), "A3".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p-legal".to_string(),
                name: "Printer-Legal".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "Legal".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p-letter".to_string(),
                name: "Printer-Letter".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["B&W".to_string(), "Letter".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p-def".to_string(),
                name: "Default-Station".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Default,
                capabilities: vec![],
                is_default: true,
            },
        ];

        // 1. Direct paper size matches
        let make_file = |size: &str| JobFile {
            file_id: format!("f-{size}"),
            filename: format!("doc_{size}.pdf"),
            mime_type: "application/pdf".to_string(),
            local_path: format!("/tmp/doc_{size}.pdf"),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: false,
                paper_size: Some(size.to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };

        assert_eq!(route_file_to_printer(&make_file("A4"), false, &printers, None).as_deref(), Some("Printer-A4"));
        assert_eq!(route_file_to_printer(&make_file("A3"), false, &printers, None).as_deref(), Some("Printer-A3"));
        assert_eq!(route_file_to_printer(&make_file("Legal"), false, &printers, None).as_deref(), Some("Printer-Legal"));
        assert_eq!(route_file_to_printer(&make_file("Letter"), false, &printers, None).as_deref(), Some("Printer-Letter"));

        // Case-insensitivity check (e.g. "legal", "a3")
        assert_eq!(route_file_to_printer(&make_file("legal"), false, &printers, None).as_deref(), Some("Printer-Legal"));
        assert_eq!(route_file_to_printer(&make_file("a3"), false, &printers, None).as_deref(), Some("Printer-A3"));

        // 2. Unmatched paper size (e.g. "Tabloid") gracefully falls back to any B&W printer
        let tabloid_file = make_file("Tabloid");
        let routed_tabloid = route_file_to_printer(&tabloid_file, false, &printers, None);
        assert!(routed_tabloid.is_some());
        let name = routed_tabloid.unwrap();
        assert!(["Printer-A4", "Printer-A3", "Printer-Legal", "Printer-Letter"].contains(&name.as_str()));

        // 3. Unmatched color job when no color printers exist falls back to default printer
        let color_file = JobFile {
            file_id: "f-col-fb".to_string(),
            filename: "photo.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/photo.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: true,
                paper_size: Some("A4".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };
        assert_eq!(route_file_to_printer(&color_file, true, &printers, None).as_deref(), Some("Default-Station"));
    }

    #[test]
    fn test_backward_compatibility_with_empty_capabilities() {
        let legacy_printers = vec![
            ConfiguredPrinter {
                id: "p1".to_string(),
                name: "Legacy-BW".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec![],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p2".to_string(),
                name: "Legacy-Color".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::Color,
                capabilities: vec![],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p3".to_string(),
                name: "Legacy-Plotter".to_string(),
                nickname: None,
                enabled: true,
                pool: PrinterPoolType::LargeFormat,
                capabilities: vec![],
                is_default: false,
            },
        ];

        let col_file = JobFile {
            file_id: "f1".to_string(),
            filename: "pic.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/pic.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: true,
                ..Default::default()
            }),
            assigned_printer: None,
        };
        assert_eq!(route_file_to_printer(&col_file, true, &legacy_printers, None).as_deref(), Some("Legacy-Color"));

        let bw_a4_file = JobFile {
            file_id: "f2".to_string(),
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
        assert_eq!(route_file_to_printer(&bw_a4_file, false, &legacy_printers, None).as_deref(), Some("Legacy-BW"));

        let a3_file = JobFile {
            file_id: "f3".to_string(),
            filename: "plan.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            local_path: "/tmp/plan.pdf".to_string(),
            pages: 1,
            settings: Some(FilePrintSettings {
                color: false,
                paper_size: Some("A3".to_string()),
                ..Default::default()
            }),
            assigned_printer: None,
        };
        assert_eq!(route_file_to_printer(&a3_file, false, &legacy_printers, None).as_deref(), Some("Legacy-Plotter"));
    }

    #[test]
    fn test_smart_auto_detection_tags_printers() {
        let (caps1, pool1) = detect_printer_capabilities("HP LaserJet Pro M404dn");
        assert_eq!(pool1, PrinterPoolType::Bw);
        assert!(caps1.contains(&"B&W".to_string()));
        assert!(caps1.contains(&"A4".to_string()));
        assert!(!caps1.contains(&"Color".to_string()));

        let (caps2, pool2) = detect_printer_capabilities("Epson EcoTank L3250 Series");
        assert_eq!(pool2, PrinterPoolType::Color);
        assert!(caps2.contains(&"B&W".to_string()));
        assert!(caps2.contains(&"Color".to_string()));
        assert!(caps2.contains(&"A4".to_string()));

        let (caps3, pool3) = detect_printer_capabilities("Canon PIXMA G3010");
        assert_eq!(pool3, PrinterPoolType::Color);
        assert!(caps3.contains(&"B&W".to_string()));
        assert!(caps3.contains(&"Color".to_string()));
        assert!(caps3.contains(&"A4".to_string()));

        let (caps4, pool4) = detect_printer_capabilities("HP DeskJet 2700 series");
        assert_eq!(pool4, PrinterPoolType::Color);
        assert!(caps4.contains(&"B&W".to_string()));
        assert!(caps4.contains(&"Color".to_string()));

        let (caps5, pool5) = detect_printer_capabilities("HP DesignJet T650 24-in A3 Plotter");
        assert_eq!(pool5, PrinterPoolType::LargeFormat);
        assert!(caps5.contains(&"A3".to_string()));
    }
}
