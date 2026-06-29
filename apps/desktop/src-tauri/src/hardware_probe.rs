use serde::{Deserialize, Serialize};
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const FIXTURES: &[(&str, &str)] = &[
    (
        "apple-silicon-m3-pro-18gb",
        include_str!("../../../../fixtures/hardware/apple_silicon_m3_pro_18gb.json"),
    ),
    (
        "intel-mac-8gb",
        include_str!("../../../../fixtures/hardware/intel_mac_8gb.json"),
    ),
    (
        "intel-mac-16gb",
        include_str!("../../../../fixtures/hardware/intel_mac_16gb.json"),
    ),
    (
        "intel-mac-32gb",
        include_str!("../../../../fixtures/hardware/intel_mac_32gb.json"),
    ),
    (
        "windows-gtx-1060-30gb",
        include_str!("../../../../fixtures/hardware/windows_gtx_1060_30gb.json"),
    ),
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum HardwareSource {
    Live,
    Fixture,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PlatformFamily {
    MacAppleSilicon,
    MacIntel,
    WindowsX64,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HardwareSpecs {
    pub id: String,
    pub name: String,
    pub source: HardwareSource,
    pub captured_at_ms: u128,
    pub platform: PlatformInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpus: Vec<GpuInfo>,
    pub storage: Vec<StorageVolume>,
    pub load: LoadInfo,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub os_version: String,
    pub architecture: String,
    pub family: PlatformFamily,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CpuInfo {
    pub brand: String,
    pub physical_cores: u32,
    pub logical_cores: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub unified_memory: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
    pub memory_bytes: Option<u64>,
    pub integrated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StorageVolume {
    pub mount: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LoadInfo {
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub gpu_percent: Option<f32>,
    pub vram_percent: Option<f32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HardwareFixtureSummary {
    pub id: String,
    pub name: String,
    pub platform: PlatformInfo,
    pub memory_bytes: u64,
    pub gpu_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum HardwareExportFormat {
    Json,
    Csv,
    Markdown,
}

pub fn probe_live_specs() -> Result<HardwareSpecs, String> {
    #[cfg(target_os = "macos")]
    {
        probe_macos()
    }

    #[cfg(target_os = "windows")]
    {
        probe_windows()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(probe_unsupported())
    }
}

pub fn list_fixtures() -> Result<Vec<HardwareFixtureSummary>, String> {
    fixtures()?
        .into_iter()
        .map(|specs| {
            let gpu_names = specs.gpus.iter().map(|gpu| gpu.name.clone()).collect();
            Ok(HardwareFixtureSummary {
                id: specs.id,
                name: specs.name,
                platform: specs.platform,
                memory_bytes: specs.memory.total_bytes,
                gpu_names,
            })
        })
        .collect()
}

pub fn load_fixture(id: &str) -> Result<HardwareSpecs, String> {
    fixtures()?
        .into_iter()
        .find(|specs| specs.id == id)
        .ok_or_else(|| format!("unknown hardware fixture: {id}"))
}

pub fn export_specs(specs: &HardwareSpecs, format: HardwareExportFormat) -> Result<String, String> {
    match format {
        HardwareExportFormat::Json => serde_json::to_string_pretty(specs)
            .map_err(|err| format!("failed to export hardware JSON: {err}")),
        HardwareExportFormat::Csv => Ok(export_csv(specs)),
        HardwareExportFormat::Markdown => Ok(export_markdown(specs)),
    }
}

fn fixtures() -> Result<Vec<HardwareSpecs>, String> {
    FIXTURES
        .iter()
        .map(|(_, raw)| {
            serde_json::from_str::<HardwareSpecs>(raw)
                .map_err(|err| format!("invalid hardware fixture: {err}"))
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn probe_macos() -> Result<HardwareSpecs, String> {
    let arch = std::env::consts::ARCH.to_string();
    let apple_silicon = sysctl_value("hw.optional.arm64")
        .map(|value| value.trim() == "1")
        .unwrap_or(arch == "aarch64");
    let total_memory = sysctl_value("hw.memsize")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or_default();
    let logical_cores = sysctl_value("hw.logicalcpu")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or_else(available_parallelism);
    let physical_cores = sysctl_value("hw.physicalcpu")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(logical_cores);
    let cpu_brand = sysctl_value("machdep.cpu.brand_string")
        .or_else(|_| sysctl_value("machdep.cpu.brand"))
        .unwrap_or_else(|_| {
            if apple_silicon {
                "Apple Silicon".to_string()
            } else {
                "Unknown Intel CPU".to_string()
            }
        });
    let os_version = command_output("sw_vers", &["-productVersion"]).unwrap_or_default();
    let storage = probe_unix_storage("/");
    let gpus = probe_macos_gpus(total_memory, apple_silicon);
    let name = if apple_silicon {
        format!("{cpu_brand} Mac")
    } else {
        format!("Intel Mac ({cpu_brand})")
    };

    Ok(HardwareSpecs {
        id: "live-machine".to_string(),
        name,
        source: HardwareSource::Live,
        captured_at_ms: now_ms(),
        platform: PlatformInfo {
            os: "macOS".to_string(),
            os_version,
            architecture: arch,
            family: if apple_silicon {
                PlatformFamily::MacAppleSilicon
            } else {
                PlatformFamily::MacIntel
            },
        },
        cpu: CpuInfo {
            brand: cpu_brand,
            physical_cores,
            logical_cores,
        },
        memory: MemoryInfo {
            total_bytes: total_memory,
            unified_memory: apple_silicon,
        },
        gpus,
        storage,
        load: LoadInfo {
            cpu_percent: 0.0,
            memory_percent: 0.0,
            gpu_percent: None,
            vram_percent: None,
        },
        notes: vec![
            "Live macOS probe uses sysctl, sw_vers, df, and system_profiler when available."
                .to_string(),
            "Stage 3 live load percentages are placeholders until background telemetry is added."
                .to_string(),
        ],
    })
}

#[cfg(target_os = "windows")]
fn probe_windows() -> Result<HardwareSpecs, String> {
    let raw = command_output(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "$cs=Get-CimInstance Win32_ComputerSystem; \
             $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; \
             $gpu=Get-CimInstance Win32_VideoController; \
             $disk=Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\"; \
             [pscustomobject]@{Computer=$cs; Cpu=$cpu; Gpu=$gpu; Disk=$disk} | ConvertTo-Json -Depth 5",
        ],
    )?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse Windows hardware probe: {err}"))?;
    let computer = &value["Computer"];
    let cpu = &value["Cpu"];
    let gpus = array_or_one(&value["Gpu"])
        .into_iter()
        .map(|gpu| GpuInfo {
            name: string_value(&gpu["Name"], "Unknown GPU"),
            vendor: gpu_vendor(&string_value(&gpu["Name"], "")),
            memory_bytes: gpu["AdapterRAM"].as_u64(),
            integrated: string_value(&gpu["Name"], "")
                .to_ascii_lowercase()
                .contains("intel"),
        })
        .collect::<Vec<_>>();
    let storage = array_or_one(&value["Disk"])
        .into_iter()
        .map(|disk| StorageVolume {
            mount: string_value(&disk["DeviceID"], "C:"),
            total_bytes: disk["Size"].as_u64().unwrap_or_default(),
            available_bytes: disk["FreeSpace"].as_u64().unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let total_memory = computer["TotalPhysicalMemory"].as_u64().unwrap_or_default();
    let logical_cores = cpu["NumberOfLogicalProcessors"]
        .as_u64()
        .map(|value| value as u32)
        .unwrap_or_else(available_parallelism);
    let physical_cores = cpu["NumberOfCores"]
        .as_u64()
        .map(|value| value as u32)
        .unwrap_or(logical_cores);

    Ok(HardwareSpecs {
        id: "live-machine".to_string(),
        name: string_value(&computer["Name"], "Windows PC"),
        source: HardwareSource::Live,
        captured_at_ms: now_ms(),
        platform: PlatformInfo {
            os: "Windows".to_string(),
            os_version: string_value(&computer["Caption"], "Windows"),
            architecture: std::env::consts::ARCH.to_string(),
            family: if std::env::consts::ARCH == "x86_64" {
                PlatformFamily::WindowsX64
            } else {
                PlatformFamily::Unsupported
            },
        },
        cpu: CpuInfo {
            brand: string_value(&cpu["Name"], "Unknown CPU"),
            physical_cores,
            logical_cores,
        },
        memory: MemoryInfo {
            total_bytes: total_memory,
            unified_memory: false,
        },
        gpus,
        storage,
        load: LoadInfo {
            cpu_percent: 0.0,
            memory_percent: 0.0,
            gpu_percent: None,
            vram_percent: None,
        },
        notes: vec![
            "Live Windows probe uses PowerShell CIM queries.".to_string(),
            "Stage 3 live load percentages are placeholders until background telemetry is added."
                .to_string(),
        ],
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn probe_unsupported() -> HardwareSpecs {
    HardwareSpecs {
        id: "live-machine".to_string(),
        name: "Unsupported platform".to_string(),
        source: HardwareSource::Live,
        captured_at_ms: now_ms(),
        platform: PlatformInfo {
            os: std::env::consts::OS.to_string(),
            os_version: "Unknown".to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            family: PlatformFamily::Unsupported,
        },
        cpu: CpuInfo {
            brand: "Unknown CPU".to_string(),
            physical_cores: available_parallelism(),
            logical_cores: available_parallelism(),
        },
        memory: MemoryInfo {
            total_bytes: 0,
            unified_memory: false,
        },
        gpus: Vec::new(),
        storage: Vec::new(),
        load: LoadInfo {
            cpu_percent: 0.0,
            memory_percent: 0.0,
            gpu_percent: None,
            vram_percent: None,
        },
        notes: vec!["Live probing is implemented for macOS and Windows in Stage 3.".to_string()],
    }
}

#[cfg(target_os = "macos")]
fn sysctl_value(name: &str) -> Result<String, String> {
    command_output("sysctl", &["-n", name])
}

#[cfg(target_os = "macos")]
fn probe_macos_gpus(total_memory: u64, apple_silicon: bool) -> Vec<GpuInfo> {
    let output = command_output("system_profiler", &["SPDisplaysDataType"]).unwrap_or_default();
    let mut gpus = output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_suffix(':')
                .filter(|name| {
                    !name.is_empty()
                        && !name.contains("Display")
                        && !name.contains("Graphics/Displays")
                })
                .map(|name| GpuInfo {
                    name: name.to_string(),
                    vendor: if name.contains("Apple") {
                        "Apple".to_string()
                    } else if name.contains("AMD") || name.contains("Radeon") {
                        "AMD".to_string()
                    } else if name.contains("Intel") {
                        "Intel".to_string()
                    } else {
                        "Unknown".to_string()
                    },
                    memory_bytes: if apple_silicon {
                        Some(total_memory)
                    } else {
                        None
                    },
                    integrated: apple_silicon || name.contains("Intel"),
                })
        })
        .collect::<Vec<_>>();

    if gpus.is_empty() {
        gpus.push(GpuInfo {
            name: if apple_silicon {
                "Apple integrated GPU".to_string()
            } else {
                "Unknown GPU".to_string()
            },
            vendor: if apple_silicon {
                "Apple".to_string()
            } else {
                "Unknown".to_string()
            },
            memory_bytes: if apple_silicon {
                Some(total_memory)
            } else {
                None
            },
            integrated: apple_silicon,
        });
    }

    gpus
}

#[cfg(target_os = "macos")]
fn probe_unix_storage(mount: &str) -> Vec<StorageVolume> {
    command_output("df", &["-k", mount])
        .ok()
        .and_then(|output| {
            output.lines().nth(1).and_then(|line| {
                let cols = line.split_whitespace().collect::<Vec<_>>();
                if cols.len() < 4 {
                    return None;
                }
                let total_kb = cols[1].parse::<u64>().ok()?;
                let available_kb = cols[3].parse::<u64>().ok()?;
                Some(StorageVolume {
                    mount: mount.to_string(),
                    total_bytes: total_kb.saturating_mul(1024),
                    available_bytes: available_kb.saturating_mul(1024),
                })
            })
        })
        .into_iter()
        .collect()
}

fn export_csv(specs: &HardwareSpecs) -> String {
    let mut rows = vec![
        vec!["section", "name", "value"],
        vec!["machine", "id", specs.id.as_str()],
        vec!["machine", "name", specs.name.as_str()],
        vec!["machine", "source", source_label(&specs.source)],
        vec!["platform", "os", specs.platform.os.as_str()],
        vec!["platform", "os_version", specs.platform.os_version.as_str()],
        vec![
            "platform",
            "architecture",
            specs.platform.architecture.as_str(),
        ],
        vec!["platform", "family", family_label(&specs.platform.family)],
        vec!["cpu", "brand", specs.cpu.brand.as_str()],
    ]
    .into_iter()
    .map(|row| row.into_iter().map(ToString::to_string).collect::<Vec<_>>())
    .collect::<Vec<_>>();

    rows.push(vec![
        "cpu".to_string(),
        "physical_cores".to_string(),
        specs.cpu.physical_cores.to_string(),
    ]);
    rows.push(vec![
        "cpu".to_string(),
        "logical_cores".to_string(),
        specs.cpu.logical_cores.to_string(),
    ]);
    rows.push(vec![
        "memory".to_string(),
        "total_bytes".to_string(),
        specs.memory.total_bytes.to_string(),
    ]);
    rows.push(vec![
        "memory".to_string(),
        "total_gb".to_string(),
        format_bytes_gb(specs.memory.total_bytes),
    ]);
    rows.push(vec![
        "memory".to_string(),
        "unified_memory".to_string(),
        specs.memory.unified_memory.to_string(),
    ]);

    for gpu in &specs.gpus {
        rows.push(vec![
            "gpu".to_string(),
            gpu.name.clone(),
            format!(
                "{}; memory={}; integrated={}",
                gpu.vendor,
                gpu.memory_bytes
                    .map(format_bytes_gb)
                    .unwrap_or_else(|| "unknown".to_string()),
                gpu.integrated
            ),
        ]);
    }

    for volume in &specs.storage {
        rows.push(vec![
            "storage".to_string(),
            volume.mount.clone(),
            format!(
                "total={}; available={}",
                format_bytes_gb(volume.total_bytes),
                format_bytes_gb(volume.available_bytes)
            ),
        ]);
    }

    rows.into_iter()
        .map(|row| {
            row.into_iter()
                .map(|cell| csv_escape(&cell))
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn export_markdown(specs: &HardwareSpecs) -> String {
    let gpu_rows = specs
        .gpus
        .iter()
        .map(|gpu| {
            format!(
                "| {} | {} | {} | {} |",
                gpu.name,
                gpu.vendor,
                gpu.memory_bytes
                    .map(format_bytes_gb)
                    .unwrap_or_else(|| "Unknown".to_string()),
                if gpu.integrated { "Yes" } else { "No" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let storage_rows = specs
        .storage
        .iter()
        .map(|volume| {
            format!(
                "| {} | {} | {} |",
                volume.mount,
                format_bytes_gb(volume.total_bytes),
                format_bytes_gb(volume.available_bytes)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# Hardware Specs: {name}\n\n\
         - Source: {source}\n\
         - Captured: {captured_at_ms}\n\
         - Platform: {os} {os_version} ({arch}, {family})\n\
         - CPU: {cpu_brand}, {physical} physical / {logical} logical cores\n\
         - Memory: {memory_gb} GB, unified memory: {unified}\n\n\
         ## GPUs\n\n\
         | Name | Vendor | Memory | Integrated |\n\
         | --- | --- | ---: | --- |\n\
         {gpu_rows}\n\n\
         ## Storage\n\n\
         | Mount | Total | Available |\n\
         | --- | ---: | ---: |\n\
         {storage_rows}\n\n\
         ## Notes\n\n\
         {notes}\n",
        name = specs.name,
        source = source_label(&specs.source),
        captured_at_ms = specs.captured_at_ms,
        os = specs.platform.os,
        os_version = specs.platform.os_version,
        arch = specs.platform.architecture,
        family = family_label(&specs.platform.family),
        cpu_brand = specs.cpu.brand,
        physical = specs.cpu.physical_cores,
        logical = specs.cpu.logical_cores,
        memory_gb = format_bytes_gb(specs.memory.total_bytes),
        unified = if specs.memory.unified_memory {
            "yes"
        } else {
            "no"
        },
        notes = specs
            .notes
            .iter()
            .map(|note| format!("- {note}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|err| format!("failed to run {program}: {err}"))?;

    if !output.status.success() {
        return Err(format!("{program} exited with status {}", output.status));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn available_parallelism() -> u32 {
    std::thread::available_parallelism()
        .map(|value| value.get() as u32)
        .unwrap_or(1)
}

#[cfg(target_os = "windows")]
fn array_or_one(value: &serde_json::Value) -> Vec<serde_json::Value> {
    match value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Null => Vec::new(),
        other => vec![other.clone()],
    }
}

#[cfg(target_os = "windows")]
fn string_value(value: &serde_json::Value, fallback: &str) -> String {
    value.as_str().unwrap_or(fallback).trim().to_string()
}

#[cfg(target_os = "windows")]
fn gpu_vendor(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("nvidia") {
        "NVIDIA".to_string()
    } else if lower.contains("amd") || lower.contains("radeon") {
        "AMD".to_string()
    } else if lower.contains("intel") {
        "Intel".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn source_label(source: &HardwareSource) -> &'static str {
    match source {
        HardwareSource::Live => "Live",
        HardwareSource::Fixture => "Fixture",
    }
}

fn family_label(family: &PlatformFamily) -> &'static str {
    match family {
        PlatformFamily::MacAppleSilicon => "MacAppleSilicon",
        PlatformFamily::MacIntel => "MacIntel",
        PlatformFamily::WindowsX64 => "WindowsX64",
        PlatformFamily::Unsupported => "Unsupported",
    }
}

pub fn format_bytes_gb(bytes: u64) -> String {
    if bytes == 0 {
        return "0".to_string();
    }

    format!("{:.1}", bytes as f64 / 1_073_741_824.0)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_required_fixtures() {
        let fixtures = fixtures().expect("fixtures parse");

        assert_eq!(fixtures.len(), 5);
        assert!(fixtures
            .iter()
            .any(|specs| specs.platform.family == PlatformFamily::MacAppleSilicon));
        assert_eq!(
            fixtures
                .iter()
                .filter(|specs| specs.platform.family == PlatformFamily::MacIntel)
                .count(),
            3
        );
        assert!(fixtures
            .iter()
            .any(|specs| specs.platform.family == PlatformFamily::WindowsX64));
    }

    #[test]
    fn fixture_summaries_include_gpu_and_memory() {
        let summaries = list_fixtures().expect("summaries load");
        let windows = summaries
            .iter()
            .find(|summary| summary.id == "windows-gtx-1060-30gb")
            .expect("windows fixture exists");

        assert_eq!(windows.memory_bytes, 32_212_254_720);
        assert!(windows
            .gpu_names
            .iter()
            .any(|name| name.contains("GTX 1060")));
    }

    #[test]
    fn exports_fixture_as_json_csv_and_markdown() {
        let specs = load_fixture("apple-silicon-m3-pro-18gb").expect("fixture loads");
        let json = export_specs(&specs, HardwareExportFormat::Json).expect("json exports");
        let csv = export_specs(&specs, HardwareExportFormat::Csv).expect("csv exports");
        let markdown =
            export_specs(&specs, HardwareExportFormat::Markdown).expect("markdown exports");

        assert!(json.contains("\"MacAppleSilicon\""));
        assert!(csv.starts_with("section,name,value"));
        assert!(csv.contains("Apple M3 Pro"));
        assert!(markdown.contains("# Hardware Specs: MacBook Pro M3 Pro 18 GB"));
        assert!(markdown.contains("## GPUs"));
    }

    #[test]
    fn rejects_unknown_fixture_id() {
        let err = load_fixture("missing").expect_err("unknown fixture fails");

        assert!(err.contains("unknown hardware fixture"));
    }
}
