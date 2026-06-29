import { invoke } from "@tauri-apps/api/core";

export type HardwareSource = "Live" | "Fixture";
export type PlatformFamily = "MacAppleSilicon" | "MacIntel" | "WindowsX64" | "Unsupported";
export type HardwareExportFormat = "Json" | "Csv" | "Markdown";

export type PlatformInfo = {
  os: string;
  os_version: string;
  architecture: string;
  family: PlatformFamily;
};

export type CpuInfo = {
  brand: string;
  physical_cores: number;
  logical_cores: number;
};

export type MemoryInfo = {
  total_bytes: number;
  unified_memory: boolean;
};

export type GpuInfo = {
  name: string;
  vendor: string;
  memory_bytes: number | null;
  integrated: boolean;
};

export type StorageVolume = {
  mount: string;
  total_bytes: number;
  available_bytes: number;
};

export type LoadInfo = {
  cpu_percent: number;
  memory_percent: number;
  gpu_percent: number | null;
  vram_percent: number | null;
};

export type HardwareSpecs = {
  id: string;
  name: string;
  source: HardwareSource;
  captured_at_ms: number;
  platform: PlatformInfo;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpus: GpuInfo[];
  storage: StorageVolume[];
  load: LoadInfo;
  notes: string[];
};

export type HardwareFixtureSummary = {
  id: string;
  name: string;
  platform: PlatformInfo;
  memory_bytes: number;
  gpu_names: string[];
};

const fallbackFixtures: HardwareSpecs[] = [
  {
    id: "apple-silicon-m3-pro-18gb",
    name: "MacBook Pro M3 Pro 18 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: {
      os: "macOS",
      os_version: "14.5",
      architecture: "aarch64",
      family: "MacAppleSilicon"
    },
    cpu: { brand: "Apple M3 Pro", physical_cores: 12, logical_cores: 12 },
    memory: { total_bytes: 19327352832, unified_memory: true },
    gpus: [
      {
        name: "Apple M3 Pro GPU",
        vendor: "Apple",
        memory_bytes: 19327352832,
        integrated: true
      }
    ],
    storage: [{ mount: "/", total_bytes: 994662584320, available_bytes: 612032839680 }],
    load: { cpu_percent: 18.5, memory_percent: 42, gpu_percent: 12, vram_percent: 42 },
    notes: [
      "Unified memory is shared by CPU and GPU.",
      "Fixture used for Apple Silicon compatibility tests."
    ]
  },
  {
    id: "intel-mac-8gb",
    name: "Intel Mac 8 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: {
      os: "macOS",
      os_version: "13.6",
      architecture: "x86_64",
      family: "MacIntel"
    },
    cpu: { brand: "Intel Core i5", physical_cores: 4, logical_cores: 8 },
    memory: { total_bytes: 8589934592, unified_memory: false },
    gpus: [
      {
        name: "Intel Iris Plus Graphics",
        vendor: "Intel",
        memory_bytes: 1536000000,
        integrated: true
      }
    ],
    storage: [{ mount: "/", total_bytes: 250685575168, available_bytes: 90194313216 }],
    load: { cpu_percent: 24, memory_percent: 61, gpu_percent: 18, vram_percent: 55 },
    notes: [
      "Constrained baseline for small quantized models.",
      "Fixture used for Intel Mac 8 GB compatibility tests."
    ]
  },
  {
    id: "intel-mac-16gb",
    name: "Intel Mac 16 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: {
      os: "macOS",
      os_version: "14.4",
      architecture: "x86_64",
      family: "MacIntel"
    },
    cpu: { brand: "Intel Core i7", physical_cores: 6, logical_cores: 12 },
    memory: { total_bytes: 17179869184, unified_memory: false },
    gpus: [
      {
        name: "AMD Radeon Pro 560X",
        vendor: "AMD",
        memory_bytes: 4294967296,
        integrated: false
      }
    ],
    storage: [{ mount: "/", total_bytes: 500277790720, available_bytes: 228034379776 }],
    load: { cpu_percent: 31, memory_percent: 58, gpu_percent: 21, vram_percent: 48 },
    notes: [
      "Representative Intel Mac with discrete AMD graphics.",
      "Fixture used for Intel Mac 16 GB compatibility tests."
    ]
  },
  {
    id: "intel-mac-32gb",
    name: "Intel Mac 32 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: {
      os: "macOS",
      os_version: "14.4",
      architecture: "x86_64",
      family: "MacIntel"
    },
    cpu: { brand: "Intel Core i9", physical_cores: 8, logical_cores: 16 },
    memory: { total_bytes: 34359738368, unified_memory: false },
    gpus: [
      {
        name: "AMD Radeon Pro 5500M",
        vendor: "AMD",
        memory_bytes: 8589934592,
        integrated: false
      }
    ],
    storage: [{ mount: "/", total_bytes: 1000240963584, available_bytes: 512092078080 }],
    load: { cpu_percent: 22, memory_percent: 44, gpu_percent: 16, vram_percent: 35 },
    notes: [
      "Higher-memory Intel Mac fixture for larger local model tests.",
      "Fixture used for Intel Mac 32 GB compatibility tests."
    ]
  },
  {
    id: "windows-gtx-1060-30gb",
    name: "Windows GTX 1060 30 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: {
      os: "Windows",
      os_version: "11 Pro 23H2",
      architecture: "x86_64",
      family: "WindowsX64"
    },
    cpu: { brand: "Intel Core i7-8700K", physical_cores: 6, logical_cores: 12 },
    memory: { total_bytes: 32212254720, unified_memory: false },
    gpus: [
      {
        name: "NVIDIA GeForce GTX 1060",
        vendor: "NVIDIA",
        memory_bytes: 6442450944,
        integrated: false
      }
    ],
    storage: [{ mount: "C:", total_bytes: 1000202273280, available_bytes: 414464000000 }],
    load: { cpu_percent: 28, memory_percent: 51, gpu_percent: 32, vram_percent: 62 },
    notes: [
      "Windows x64 baseline with GTX 1060 6 GB VRAM and 30 GB system RAM.",
      "Fixture used for remote broker and compatibility tests."
    ]
  }
];

export async function refreshHardwareSpecs(): Promise<HardwareSpecs> {
  if (isTauriRuntime()) {
    return invoke<HardwareSpecs>("refresh_hardware_specs");
  }

  return {
    ...fallbackFixtures[0],
    id: "browser-live-sample",
    name: "Browser Preview Fixture",
    source: "Live",
    notes: [
      "Browser preview uses fixture-backed data.",
      "Native Tauri builds call the Rust hardware probe."
    ]
  };
}

export async function listHardwareFixtures(): Promise<HardwareFixtureSummary[]> {
  if (isTauriRuntime()) {
    return invoke<HardwareFixtureSummary[]>("list_hardware_fixtures");
  }

  return fallbackFixtures.map((specs) => ({
    id: specs.id,
    name: specs.name,
    platform: specs.platform,
    memory_bytes: specs.memory.total_bytes,
    gpu_names: specs.gpus.map((gpu) => gpu.name)
  }));
}

export async function loadHardwareFixture(id: string): Promise<HardwareSpecs> {
  if (isTauriRuntime()) {
    return invoke<HardwareSpecs>("load_hardware_fixture", { id });
  }

  const fixture = fallbackFixtures.find((specs) => specs.id === id);
  if (!fixture) {
    throw new Error(`Unknown hardware fixture: ${id}`);
  }
  return fixture;
}

export async function exportHardwareSpecs(
  specs: HardwareSpecs,
  format: HardwareExportFormat
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("export_hardware_specs", { specs, format });
  }

  if (format === "Json") {
    return JSON.stringify(specs, null, 2);
  }
  if (format === "Csv") {
    return exportCsv(specs);
  }
  return exportMarkdown(specs);
}

export function formatBytesGb(bytes: number | null): string {
  if (!bytes) return "Unknown";
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function exportCsv(specs: HardwareSpecs): string {
  const rows = [
    ["section", "name", "value"],
    ["machine", "id", specs.id],
    ["machine", "name", specs.name],
    ["machine", "source", specs.source],
    ["platform", "os", specs.platform.os],
    ["platform", "os_version", specs.platform.os_version],
    ["platform", "architecture", specs.platform.architecture],
    ["platform", "family", specs.platform.family],
    ["cpu", "brand", specs.cpu.brand],
    ["cpu", "physical_cores", String(specs.cpu.physical_cores)],
    ["cpu", "logical_cores", String(specs.cpu.logical_cores)],
    ["memory", "total_bytes", String(specs.memory.total_bytes)],
    ["memory", "total_gb", formatBytesGb(specs.memory.total_bytes)],
    ["memory", "unified_memory", String(specs.memory.unified_memory)]
  ];

  for (const gpu of specs.gpus) {
    rows.push([
      "gpu",
      gpu.name,
      `${gpu.vendor}; memory=${formatBytesGb(gpu.memory_bytes)}; integrated=${gpu.integrated}`
    ]);
  }

  for (const volume of specs.storage) {
    rows.push([
      "storage",
      volume.mount,
      `total=${formatBytesGb(volume.total_bytes)}; available=${formatBytesGb(volume.available_bytes)}`
    ]);
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function exportMarkdown(specs: HardwareSpecs): string {
  const gpus = specs.gpus
    .map(
      (gpu) =>
        `| ${gpu.name} | ${gpu.vendor} | ${formatBytesGb(gpu.memory_bytes)} | ${
          gpu.integrated ? "Yes" : "No"
        } |`
    )
    .join("\n");
  const storage = specs.storage
    .map(
      (volume) =>
        `| ${volume.mount} | ${formatBytesGb(volume.total_bytes)} | ${formatBytesGb(
          volume.available_bytes
        )} |`
    )
    .join("\n");

  return `# Hardware Specs: ${specs.name}

- Source: ${specs.source}
- Captured: ${specs.captured_at_ms}
- Platform: ${specs.platform.os} ${specs.platform.os_version} (${specs.platform.architecture}, ${specs.platform.family})
- CPU: ${specs.cpu.brand}, ${specs.cpu.physical_cores} physical / ${specs.cpu.logical_cores} logical cores
- Memory: ${formatBytesGb(specs.memory.total_bytes)}, unified memory: ${
    specs.memory.unified_memory ? "yes" : "no"
  }

## GPUs

| Name | Vendor | Memory | Integrated |
| --- | --- | ---: | --- |
${gpus}

## Storage

| Mount | Total | Available |
| --- | ---: | ---: |
${storage}

## Notes

${specs.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.split('"').join('""')}"`;
  }
  return value;
}
