const DEFAULT_SETTINGS = {
  hostname: "apple-tv.local",
  playPosition: "current"
};

const form = document.getElementById("settings-form");
const hostnameInput = document.getElementById("hostname");
const playPositionCurrent = document.getElementById("play-position-current");
const playPositionStart = document.getElementById("play-position-0");
const statusNode = document.getElementById("status");
const resetButton = document.getElementById("reset");
const testAirPlayButton = document.getElementById("test-airplay");
const discoverButton = document.getElementById("discover");

document.addEventListener("DOMContentLoaded", restoreOptions);
form.addEventListener("submit", saveOptions);
resetButton.addEventListener("click", resetOptions);
testAirPlayButton.addEventListener("click", testAirPlay);
discoverButton.addEventListener("click", discoverDevices);

async function restoreOptions() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  hostnameInput.value = stored.hostname || DEFAULT_SETTINGS.hostname;
  const playPosition = stored.playPosition || DEFAULT_SETTINGS.playPosition;
  playPositionCurrent.checked = playPosition === "current";
  playPositionStart.checked = playPosition !== "current";
}

async function saveOptions(event) {
  event.preventDefault();

  await chrome.storage.local.set({
    hostname: hostnameInput.value.trim() || DEFAULT_SETTINGS.hostname,
    playPosition: playPositionCurrent.checked ? "current" : "0"
  });

  showStatus("Settings saved.");
}

async function resetOptions() {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  await restoreOptions();
  showStatus("Defaults restored.");
}

async function testAirPlay() {
  await chrome.storage.local.set({
    hostname: hostnameInput.value.trim() || DEFAULT_SETTINGS.hostname,
    playPosition: playPositionCurrent.checked ? "current" : "0"
  });

  showStatus("Testing AirPlay receiver...");
  const response = await chrome.runtime.sendMessage({ type: "TEST_AIRPLAY" });

  if (response?.ok) {
    showStatus("AirPlay receiver responded.");
    return;
  }

  showStatus(response?.error || "AirPlay receiver test failed.");
}

function showStatus(text) {
  statusNode.textContent = text;
  statusNode.className = "status visible";
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    statusNode.className = "status";
  }, 2200);
}

async function discoverDevices() {
  discoverButton.disabled = true;
  discoverButton.textContent = "Scanning…";
  document.getElementById("discovery-results").innerHTML = "";
  showStatus("Detecting network adapters…");

  const subnets = await getAllLocalSubnets();
  if (subnets.length === 0) {
    discoverButton.disabled = false;
    discoverButton.textContent = "Scan for AirPlay devices";
    showStatus("Could not determine local IP. Make sure you are on a Wi-Fi or LAN network.");
    return;
  }

  if (subnets.length > 1) {
    discoverButton.disabled = false;
    discoverButton.textContent = "Scan for AirPlay devices";
    renderSubnetPicker(subnets);
    showStatus("Multiple network adapters found. Choose which subnet to scan.");
    return;
  }

  await scanSubnet(subnets[0]);
}

function renderSubnetPicker(subnets) {
  const container = document.getElementById("discovery-results");
  container.innerHTML = "";

  const label = document.createElement("p");
  label.className = "discovery-label";
  label.textContent = "Multiple adapters detected — choose a subnet to scan:";
  container.appendChild(label);

  subnets.forEach((subnet) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "device-chip";
    btn.textContent = `${subnet}.0/24`;
    btn.addEventListener("click", async () => {
      container.innerHTML = "";
      discoverButton.disabled = true;
      discoverButton.textContent = "Scanning…";
      await scanSubnet(subnet);
    });
    container.appendChild(btn);
  });
}

async function scanSubnet(subnet) {
  showStatus(`Scanning ${subnet}.1–254 for AirPlay receivers…`);

  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  const settled = await Promise.allSettled(ips.map(probeAirPlay));
  const devices = settled
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);

  discoverButton.disabled = false;
  discoverButton.textContent = "Scan for AirPlay devices";

  renderDiscoveryResults(devices);

  if (devices.length === 0) {
    showStatus("No AirPlay receivers found. Make sure your Apple TV is on and on the same network.");
  } else {
    showStatus(`Found ${devices.length} AirPlay receiver${devices.length === 1 ? "" : "s"}.`);
  }
}

function getAllLocalSubnets() {
  return new Promise((resolve) => {
    const subnets = new Set();
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      resolve([...subnets]);
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(finish);

      const timer = setTimeout(() => { pc.close(); finish(); }, 3500);

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) {
          clearTimeout(timer);
          pc.close();
          finish();
          return;
        }
        const m = candidate.candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})/);
        if (m) {
          const subnet = m[1];
          const host = Number(m[2]);
          if (!subnet.startsWith("127.") && !subnet.startsWith("169.254") && host !== 0) {
            subnets.add(subnet);
          }
        }
      };
    } catch {
      finish();
    }
  });
}

async function probeAirPlay(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://${ip}:7000/server-info`, {
      method: "GET",
      headers: { Authorization: "Basic QWlyUGxheTo=" },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      return null;
    }

    let label = "AirPlay Receiver";
    try {
      const buf = await response.arrayBuffer();
      const text = new TextDecoder("latin1").decode(buf);
      const m =
        text.match(/Apple\s?TV[\w,]*/i) ||
        text.match(/HomePod[\w,]*/i) ||
        text.match(/AirPort[\w,]*/i) ||
        text.match(/<string>([^<]{3,50})<\/string>/);
      if (m) {
        label = m[0].replace(/<string>|<\/string>/g, "").trim();
      }
    } catch {}

    return { ip, label: `${label} — ${ip}` };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function renderDiscoveryResults(devices) {
  const container = document.getElementById("discovery-results");
  container.innerHTML = "";
  devices.forEach(({ ip, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "device-chip";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      hostnameInput.value = ip;
      showStatus(`Selected ${label}. Save settings to apply.`);
    });
    container.appendChild(btn);
  });
}
