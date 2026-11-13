#!/usr/bin/env node

/**
 * Consolidates all platform assets and signatures from a GitHub Release into
 * a single unified latest.json file for the Tauri v2 updater.
 *
 * This prevents the multi-platform matrix race condition where parallel jobs
 * overwrite latest.json, leaving only the last-finishing platform.
 */

const fs = require("fs");
const https = require("https");
const { execSync } = require("child_process");

const repo = process.env.GITHUB_REPOSITORY || "dharantej1/JetPrint";
const tag = process.env.TAG_NAME || process.env.GITHUB_REF_NAME;
const token = process.env.GITHUB_TOKEN;

if (!tag) {
  console.error("Missing TAG_NAME or GITHUB_REF_NAME environment variable.");
  process.exit(1);
}

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      "User-Agent": "JetPrint-Release-Consolidator",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    };

    https
      .get(url, { headers: defaultHeaders }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetch(res.headers.location, headers).then(resolve, reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`HTTP ${res.statusCode} from ${url}`)
          );
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

async function main() {
  console.log(`Consolidating updater manifest for repository ${repo}, release tag ${tag}...`);

  const releaseJsonStr = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    { Accept: "application/vnd.github.v3+json" }
  );
  const release = JSON.parse(releaseJsonStr);
  const assets = release.assets || [];

  console.log(`Found ${assets.length} total release assets.`);

  const assetMap = new Map();
  for (const asset of assets) {
    assetMap.set(asset.name, asset);
  }

  const platforms = {};

  // Platform mappings based on signature files and target binaries
  const platformRules = [
    // macOS Apple Silicon
    {
      keys: ["darwin-aarch64", "darwin-aarch64-app"],
      sigPattern: /^JetPrint_aarch64\.app\.tar\.gz\.sig$/,
      binName: "JetPrint_aarch64.app.tar.gz",
    },
    // macOS Intel
    {
      keys: ["darwin-x86_64", "darwin-x86_64-app"],
      sigPattern: /^JetPrint_x64\.app\.tar\.gz\.sig$/,
      binName: "JetPrint_x64.app.tar.gz",
    },
    // Windows NSIS Setup
    {
      keys: ["windows-x86_64", "windows-x86_64-nsis"],
      sigPattern: /^JetPrint_.*_x64-setup\.exe\.sig$/,
      binPattern: /^JetPrint_.*_x64-setup\.exe$/,
    },
    // Windows MSI
    {
      keys: ["windows-x86_64-msi"],
      sigPattern: /^JetPrint_.*_x64_.*\.msi\.sig$/,
      binPattern: /^JetPrint_.*_x64_.*\.msi$/,
    },
    // Linux x86_64 AppImage
    {
      keys: ["linux-x86_64", "linux-x86_64-appimage"],
      sigPattern: /^JetPrint_.*_amd64\.AppImage\.sig$/,
      binPattern: /^JetPrint_.*_amd64\.AppImage$/,
    },
    // Linux x86_64 Debian
    {
      keys: ["linux-x86_64-deb"],
      sigPattern: /^JetPrint_.*_amd64\.deb\.sig$/,
      binPattern: /^JetPrint_.*_amd64\.deb$/,
    },
    // Linux x86_64 RPM
    {
      keys: ["linux-x86_64-rpm"],
      sigPattern: /^JetPrint-.*\.x86_64\.rpm\.sig$/,
      binPattern: /^JetPrint-.*\.x86_64\.rpm$/,
    },
    // Linux ARM64 (Raspberry Pi) AppImage
    {
      keys: ["linux-aarch64", "linux-aarch64-appimage"],
      sigPattern: /^JetPrint_.*_aarch64\.AppImage\.sig$/,
      binPattern: /^JetPrint_.*_aarch64\.AppImage$/,
    },
    // Linux ARM64 (Raspberry Pi) Debian
    {
      keys: ["linux-aarch64-deb"],
      sigPattern: /^JetPrint_.*_arm64\.deb\.sig$/,
      binPattern: /^JetPrint_.*_arm64\.deb$/,
    },
    // Linux ARM64 (Raspberry Pi) RPM
    {
      keys: ["linux-aarch64-rpm"],
      sigPattern: /^JetPrint-.*\.aarch64\.rpm\.sig$/,
      binPattern: /^JetPrint-.*\.aarch64\.rpm$/,
    },
  ];

  for (const rule of platformRules) {
    let sigAsset = null;
    let binAsset = null;

    for (const [name, asset] of assetMap.entries()) {
      if (rule.sigPattern.test(name)) {
        sigAsset = asset;
        break;
      }
    }

    if (!sigAsset) {
      console.warn(`No signature found matching ${rule.sigPattern}`);
      continue;
    }

    if (rule.binName) {
      binAsset = assetMap.get(rule.binName);
    } else if (rule.binPattern) {
      for (const [name, asset] of assetMap.entries()) {
        if (rule.binPattern.test(name)) {
          binAsset = asset;
          break;
        }
      }
    }

    if (!binAsset) {
      console.warn(`Signature ${sigAsset.name} found, but matching binary missing.`);
      continue;
    }

    console.log(`Downloading signature: ${sigAsset.name}...`);
    const signatureText = (await fetch(sigAsset.browser_download_url)).trim();

    for (const key of rule.keys) {
      platforms[key] = {
        signature: signatureText,
        url: binAsset.browser_download_url,
      };
      console.log(`  ✓ Mapped ${key} -> ${binAsset.name}`);
    }
  }

  const platformCount = Object.keys(platforms).length;
  console.log(`Total platforms mapped: ${platformCount}`);

  if (platformCount === 0) {
    throw new Error("No platforms could be mapped! Check release assets.");
  }

  const ver = tag.replace(/^v/, "");
  const unifiedLatest = {
    version: ver,
    notes: release.body || "See the assets to download and install this version.",
    pub_date: new Date().toISOString(),
    platforms,
  };

  const outputPath = "latest.json";
  fs.writeFileSync(outputPath, JSON.stringify(unifiedLatest, null, 2) + "\n");
  console.log(`Wrote unified ${outputPath}`);

  console.log(`Uploading ${outputPath} to GitHub release ${tag}...`);
  execSync(`gh release upload "${tag}" "${outputPath}" --clobber`, {
    stdio: "inherit",
    env: process.env,
  });

  console.log("Successfully published consolidated latest.json to release!");
}

main().catch((err) => {
  console.error("Consolidation failed:", err);
  process.exit(1);
});
