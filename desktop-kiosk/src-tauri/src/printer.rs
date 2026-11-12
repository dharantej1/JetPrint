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

/// Prints all files in a job to the configured printer (or OS default printer).
pub fn print_job_files(
    printer_name: Option<&str>,
    files: &[JobFile],
    copies: u32,
    color: bool,
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

    let copies_str = copies.max(1).to_string();
    let color_str = if color { "Color" } else { "Monochrome" };
    let raw_properties = [("copies", copies_str.as_str()), ("ColorModel", color_str)];

    for file in files {
        let path = std::path::Path::new(&file.local_path);
        if !path.exists() {
            return Err(format!(
                "Downloaded file missing on disk: {}",
                file.filename
            ));
        }

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
