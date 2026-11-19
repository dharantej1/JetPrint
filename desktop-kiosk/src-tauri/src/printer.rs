use printers::common::base::job::PrinterJobOptions;
use printers::{get_default_printer, get_printer_by_name, get_printers};

use crate::models::{JobFile, PrinterInfo};

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
        };
        let props = build_file_print_properties(&file, 1, false, None);
        assert!(props.contains(&("orientation-requested", "3".to_string())));
        assert!(props.contains(&("media", "Legal".to_string())));
        assert!(props.contains(&("PageSize", "Legal".to_string())));
        assert!(!props.iter().any(|(k, _)| *k == "number-up"));
        assert!(!props.iter().any(|(k, _)| *k == "page-ranges"));
    }
}
