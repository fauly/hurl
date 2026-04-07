const DEFAULT_SETTINGS = {
	hostname: "apple-tv.local",
	playPosition: "current"
};

const videoList = document.getElementById("video-list");
const messageNode = document.getElementById("message");
const viewMain = document.getElementById("view-main");
const viewSettings = document.getElementById("view-settings");
const toggleSettingsButton = document.getElementById("toggle-settings");
const settingsForm = document.getElementById("settings-form");
const hostnameInput = document.getElementById("hostname");
const playPositionCurrent = document.getElementById("play-position-current");
const playPositionStart = document.getElementById("play-position-0");
const statusText = document.getElementById("status");
const resetButton = document.getElementById("reset");
const testAirPlayButton = document.getElementById("test-airplay");
const discoverButton = document.getElementById("discover");

document.addEventListener("DOMContentLoaded", init);

async function init() {
	await loadSettings();
	toggleSettingsButton.addEventListener("click", () => {
		const isSettings = !viewSettings.classList.contains("hidden");
		viewSettings.classList.toggle("hidden", isSettings);
		viewMain.classList.toggle("hidden", !isSettings);
		toggleSettingsButton.textContent = isSettings ? "Settings" : "Done";
	});
	settingsForm.addEventListener("submit", saveSettings);
	resetButton.addEventListener("click", resetSettings);
	testAirPlayButton.addEventListener("click", testAirPlay);
	discoverButton.addEventListener("click", discoverDevices);
	initializePopup();
}

async function initializePopup() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) {
			renderEmptyState("No active tab was found.");
			return;
		}

		const backgroundResult = await chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: tab.id });

		const pageCandidates = backgroundResult?.ok ? backgroundResult.pageCandidates : [];
		const networkCandidates = backgroundResult?.ok ? backgroundResult.networkCandidates : [];
		const candidates = mergeCandidates(pageCandidates, networkCandidates);

		if (candidates.length === 0) {
			renderEmptyState(buildEmptyStateText(tab));
			return;
		}

		renderCandidates(tab.id, candidates);
	} catch (error) {
		renderEmptyState(error.message || "Unable to read the current tab.");
	}
}

function mergeCandidates(pageCandidates, networkCandidates) {
	const merged = [];
	const seenUrls = new Set();

	[...pageCandidates, ...networkCandidates].forEach((candidate) => {
		if (!candidate?.url || seenUrls.has(candidate.url)) {
			return;
		}
		seenUrls.add(candidate.url);
		merged.push(candidate);
	});

	return merged;
}

function renderCandidates(tabId, candidates) {
	videoList.innerHTML = "";
	candidates.forEach((candidate) => {
		const isBlobCandidate = candidate.delivery === "blob" || String(candidate.url || "").startsWith("blob:");
		const item = document.createElement("div");
		item.className = "source-item";
		const tagClass = candidate.directPlayable ? "format-tag format-tag-playable" : "format-tag";
		item.innerHTML = `
			<div class="source-row">
				<span class="source-title">${escapeHtml(candidate.title || "Detected video")}</span>
				<span class="${tagClass}">${escapeHtml(candidate.delivery || "stream")}</span>
			</div>
			<p class="source-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.url)}</p>
			${isBlobCandidate ? `<p class="source-hint">This site is using a browser-managed blob stream. Hurl cannot send it directly to AirPlay.</p>` : ""}
			<div class="source-actions"></div>
		`;

		const actions = item.querySelector(".source-actions");
		if (!isBlobCandidate) {
			const airplayButton = makeButton("Send to AirPlay", candidate.directPlayable, async () => {
				const response = await chrome.runtime.sendMessage({
					type: "PLAY_AIRPLAY",
					url: candidate.url,
					position: candidate.position || 0,
					contentType: candidate.contentType || ""
				});

				if (!response?.ok) {
					showMessage(response?.error || "AirPlay request failed.", true);
					return;
				}

				showMessage("AirPlay request sent.");
			}, "primary");
			actions.appendChild(airplayButton);
		}

		if (!actions.childElementCount) {
			actions.remove();
		}

		videoList.appendChild(item);
	});
}

function renderEmptyState(text) {
	videoList.innerHTML = `<section class="empty-state"><p>${escapeHtml(text)}</p></section>`;
}

function buildEmptyStateText(tab) {
	if (tab.url?.startsWith("file://")) {
		return "Local file — saved pages rarely embed the real stream. Test on the live site after starting playback.";
	}

	return "No compatible video URL detected. Start playback on the page, then reopen the popup.";
}

function makeButton(label, enabled, onClick, variant = "primary") {
	const button = document.createElement("button");
	button.type = "button";
	button.className = enabled ? `btn btn-${variant}` : "btn";
	button.textContent = label;
	button.disabled = !enabled;
	if (enabled) {
		button.addEventListener("click", onClick);
	}
	return button;
}

function showMessage(text, isError = false) {
	messageNode.textContent = text;
	messageNode.className = isError ? "message" : "message message-success";
}

function escapeHtml(text) {
	return String(text)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
	const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
	hostnameInput.value = stored.hostname || DEFAULT_SETTINGS.hostname;
	const pos = stored.playPosition || DEFAULT_SETTINGS.playPosition;
	playPositionCurrent.checked = pos === "current";

	playPositionStart.checked = pos !== "current";
}

async function saveSettings(event) {
	event.preventDefault();
	await chrome.storage.local.set({
		hostname: hostnameInput.value.trim() || DEFAULT_SETTINGS.hostname,
		playPosition: playPositionCurrent.checked ? "current" : "0"
	});
	showSettingsStatus("Saved.");
}

async function resetSettings() {
	await chrome.storage.local.set(DEFAULT_SETTINGS);
	await loadSettings();
	showSettingsStatus("Reset to defaults.");
}

async function testAirPlay() {
	await chrome.storage.local.set({
		hostname: hostnameInput.value.trim() || DEFAULT_SETTINGS.hostname,
		playPosition: playPositionCurrent.checked ? "current" : "0"
	});
	showSettingsStatus("Testing…");
	const response = await chrome.runtime.sendMessage({ type: "TEST_AIRPLAY" });
	showSettingsStatus(response?.ok ? "Receiver responded." : (response?.error || "Test failed."));
}

function showSettingsStatus(text) {
	statusText.textContent = text;
	statusText.classList.add("visible");
	clearTimeout(showSettingsStatus._t);
	showSettingsStatus._t = setTimeout(() => statusText.classList.remove("visible"), 2500);
}

async function discoverDevices() {
	discoverButton.disabled = true;
	discoverButton.textContent = "Scanning…";
	document.getElementById("discovery-results").innerHTML = "";
	showSettingsStatus("Detecting adapters…");

	const subnets = await getAllLocalSubnets();
	if (subnets.length === 0) {
		discoverButton.disabled = false;
		discoverButton.textContent = "Scan";
		showSettingsStatus("No local network found.");
		return;
	}
	if (subnets.length > 1) {
		discoverButton.disabled = false;
		discoverButton.textContent = "Scan";
		renderSubnetPicker(subnets);
		showSettingsStatus("Pick a subnet to scan.");
		return;
	}
	await scanSubnet(subnets[0]);
}

function renderSubnetPicker(subnets) {
	const container = document.getElementById("discovery-results");
	container.innerHTML = "";
	const label = document.createElement("p");
	label.className = "discovery-label";
	label.textContent = "Choose subnet:";
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
	showSettingsStatus(`Scanning ${subnet}.1–254…`);
	const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
	const settled = await Promise.allSettled(ips.map(probeAirPlay));
	const devices = settled.filter((r) => r.status === "fulfilled" && r.value !== null).map((r) => r.value);
	discoverButton.disabled = false;
	discoverButton.textContent = "Scan";
	renderDiscoveryResults(devices);
	showSettingsStatus(devices.length === 0 ? "No receivers found." : `Found ${devices.length}.`);
}

function getAllLocalSubnets() {
	return new Promise((resolve) => {
		const subnets = new Set();
		let finished = false;
		function finish() { if (finished) return; finished = true; resolve([...subnets]); }
		try {
			const pc = new RTCPeerConnection({ iceServers: [] });
			pc.createDataChannel("");
			pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(finish);
			const timer = setTimeout(() => { pc.close(); finish(); }, 3500);
			pc.onicecandidate = ({ candidate }) => {
				if (!candidate) { clearTimeout(timer); pc.close(); finish(); return; }
				const m = candidate.candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})/);
				if (m && !m[1].startsWith("127.") && !m[1].startsWith("169.254") && Number(m[2]) !== 0) {
					subnets.add(m[1]);
				}
			};
		} catch { finish(); }
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
		if (!response.ok) return null;
		let label = "AirPlay Receiver";
		try {
			const text = new TextDecoder("latin1").decode(await response.arrayBuffer());
			const m = text.match(/Apple\s?TV[\w,]*/i) || text.match(/HomePod[\w,]*/i) ||
				text.match(/AirPort[\w,]*/i) || text.match(/<string>([^<]{3,50})<\/string>/);
			if (m) label = m[0].replace(/<string>|<\/string>/g, "").trim();
		} catch {}
		return { ip, label: `${label} — ${ip}` };
	} catch { clearTimeout(timer); return null; }
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
			showSettingsStatus(`Selected. Save to apply.`);
		});
		container.appendChild(btn);
	});
}
