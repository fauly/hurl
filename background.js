const DEFAULT_SETTINGS = {
	hostname: "apple-tv.local",
	playPosition: "current",
	castBridgeUrl: "http://127.0.0.1:47991",
	castDeviceName: ""
};

const AIRPLAY_AUTH_HEADER = "Basic QWlyUGxheTo=";
const MEDIA_PATH_RE = /\.(m3u8|mp4|m4v|mov|webm|mpd|ogv|ogg)(?:$|[?#])/i;
const NETWORK_CANDIDATE_LIMIT = 12;
const networkMediaByTab = new Map();
const pageMediaByTab = new Map();

chrome.runtime.onInstalled.addListener(async () => {
	await ensureDefaultSettings();
	await rebuildContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
	const candidateUrl = info.mediaType === "video" ? info.srcUrl : info.linkUrl;
	if (!candidateUrl) {
		return;
	}

	if (!isDirectMediaUrl(candidateUrl)) {
		await notify(
			"Hurl",
			"That link is not a direct video stream. Open the page and use the popup to detect the actual media source."
		);
		return;
	}

	try {
		await playOnAirPlay(candidateUrl, 0);
	} catch (error) {
		await notify("Hurl", error.message || "AirPlay request failed.");
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	networkMediaByTab.delete(tabId);
	pageMediaByTab.delete(tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
	(details) => {
		if (details.tabId < 0 || !details.url) {
			return;
		}

		const contentType = findHeader(details.responseHeaders, "content-type");
		if (!isLikelyMediaRequest(details.url, contentType)) {
			return;
		}

		recordNetworkCandidate(details.tabId, {
			id: `network:${details.requestId}`,
			source: "network",
			title: extractFileLabel(details.url),
			pageTitle: "Recent network media",
			url: details.url,
			delivery: inferDelivery(details.url, contentType),
			directPlayable: isDirectMediaCandidate(details.url, contentType),
			remotePlaybackSupported: false,
			position: 0,
			duration: null,
			contentType: contentType || ""
		});
	},
	{ urls: ["<all_urls>"] },
	["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	handleMessage(message, sender)
		.then((response) => sendResponse(response))
		.catch((error) => sendResponse({ ok: false, error: error.message || "Unexpected error." }));

	return true;
});

async function handleMessage(message, sender) {
	switch (message?.type) {
		case "GET_TAB_MEDIA": {
			const settings = await getSettings();
			return {
				ok: true,
				settings,
				pageCandidates: getPageCandidates(message.tabId),
				networkCandidates: getNetworkCandidates(message.tabId)
			};
		}

		case "REPORT_PAGE_MEDIA": {
			if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
				recordPageCandidates(sender.tab.id, sender.frameId, message.candidates || []);
			}
			return { ok: true };
		}

		case "PLAY_AIRPLAY": {
			await playOnAirPlay(message.url, Number(message.position) || 0, message.contentType || "");
			return { ok: true };
		}

		case "TEST_AIRPLAY": {
			const result = await testAirPlayTarget();
			return { ok: result.ok, error: result.error || "" };
		}

		case "PLAY_CHROMECAST": {
			await playOnChromecast(message.url, Number(message.position) || 0, message.contentType || "");
			return { ok: true };
		}

		case "TEST_CHROMECAST": {
			const result = await testChromecastBridge();
			return { ok: result.ok, error: result.error || "" };
		}

		default:
			return { ok: false, error: "Unknown request." };
	}
}

async function ensureDefaultSettings() {
	const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
	const missing = {};

	for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
		if (stored[key] === undefined) {
			missing[key] = value;
		}
	}

	if (Object.keys(missing).length > 0) {
		await chrome.storage.local.set(missing);
	}
}

async function rebuildContextMenus() {
	await chrome.contextMenus.removeAll();
	chrome.contextMenus.create({
		id: "hurl-airplay-video",
		title: "Send Video to AirPlay",
		contexts: ["video"]
	});
	chrome.contextMenus.create({
		id: "hurl-airplay-link",
		title: "Send Link to AirPlay",
		contexts: ["link"]
	});
}

async function getSettings() {
	const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
	return {
		hostname: sanitizeHostname(stored.hostname || DEFAULT_SETTINGS.hostname),
		playPosition: stored.playPosition || DEFAULT_SETTINGS.playPosition,
		castBridgeUrl: sanitizeBridgeUrl(stored.castBridgeUrl || DEFAULT_SETTINGS.castBridgeUrl),
		castDeviceName: String(stored.castDeviceName || DEFAULT_SETTINGS.castDeviceName).trim()
	};
}

function sanitizeHostname(value) {
	return String(value || DEFAULT_SETTINGS.hostname)
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/\/$/, "");
}

function sanitizeBridgeUrl(value) {
	const fallback = DEFAULT_SETTINGS.castBridgeUrl;
	const raw = String(value || fallback).trim();
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
	try {
		const parsed = new URL(withScheme);
		return parsed.origin;
	} catch {
		return fallback;
	}
}

function findHeader(headers = [], name) {
	const normalizedName = name.toLowerCase();
	const header = headers.find((item) => item.name.toLowerCase() === normalizedName);
	return header?.value || "";
}

function isDirectMediaUrl(url) {
	if (!url || url.startsWith("blob:") || url.startsWith("data:")) {
		return false;
	}

	try {
		const parsed = new URL(url);
		return ["http:", "https:"].includes(parsed.protocol) && MEDIA_PATH_RE.test(parsed.href);
	} catch {
		return false;
	}
}

function isDirectMediaCandidate(url, contentType = "") {
	if (isDirectMediaUrl(url)) {
		return true;
	}

	const normalizedType = String(contentType).toLowerCase();
	return (
		normalizedType.startsWith("video/") ||
		normalizedType.includes("mpegurl")
	);
}

function isLikelyMediaRequest(url, contentType = "") {
	if (!url || url.startsWith("blob:") || url.startsWith("data:")) {
		return false;
	}

	const normalizedType = String(contentType).toLowerCase();
	if (
		normalizedType.startsWith("video/") ||
		normalizedType.startsWith("audio/") ||
		normalizedType.includes("mpegurl") ||
		normalizedType.includes("dash+xml")
	) {
		return true;
	}

	return MEDIA_PATH_RE.test(url);
}

function inferDelivery(url, contentType = "") {
	const normalizedType = String(contentType).toLowerCase();
	if (normalizedType.includes("mpegurl") || /\.m3u8(?:$|[?#])/i.test(url)) {
		return "hls";
	}
	if (normalizedType.includes("dash+xml") || /\.mpd(?:$|[?#])/i.test(url)) {
		return "dash";
	}
	if (/\.(mp4|m4v|mov)(?:$|[?#])/i.test(url)) {
		return "file";
	}
	if (/\.webm(?:$|[?#])/i.test(url)) {
		return "webm";
	}
	return "stream";
}

function extractFileLabel(url) {
	try {
		const parsed = new URL(url);
		const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
		return lastSegment || parsed.hostname;
	} catch {
		return "Detected stream";
	}
}

function recordNetworkCandidate(tabId, candidate) {
	const existing = networkMediaByTab.get(tabId) || [];
	const deduped = existing.filter((item) => item.url !== candidate.url);
	deduped.unshift(candidate);
	networkMediaByTab.set(tabId, deduped.slice(0, NETWORK_CANDIDATE_LIMIT));
}

function getNetworkCandidates(tabId) {
	return [...(networkMediaByTab.get(tabId) || [])];
}

function recordPageCandidates(tabId, frameId, candidates) {
	const frameMap = pageMediaByTab.get(tabId) || new Map();
	const normalizedCandidates = candidates.map((candidate, index) => ({
		...candidate,
		id: candidate.id || `frame:${frameId}:${index}`,
		frameId
	}));
	frameMap.set(frameId, normalizedCandidates);
	pageMediaByTab.set(tabId, frameMap);
}

function getPageCandidates(tabId) {
	const frameMap = pageMediaByTab.get(tabId);
	if (!frameMap) {
		return [];
	}

	const mergedCandidates = [];
	for (const candidates of frameMap.values()) {
		mergedCandidates.push(...candidates);
	}
	return mergedCandidates;
}

function buildAirPlayBaseUrl(hostname) {
	const normalizedHostname = sanitizeHostname(hostname);
	const hostWithPort = /:\d+$/.test(normalizedHostname)
		? normalizedHostname
		: `${normalizedHostname}:7000`;
	return `http://${hostWithPort}`;
}

async function playOnAirPlay(url, requestedPosition, contentType = "") {
	if (!url) {
		throw new Error("No video URL was provided.");
	}

	if (!isDirectMediaCandidate(url, contentType)) {
		throw new Error(
			"Hurl can only send direct media URLs to AirPlay. DRM, blob, and protected streams must stay in the browser player."
		);
	}

	const settings = await getSettings();
	const baseUrl = buildAirPlayBaseUrl(settings.hostname);
	const startPosition = settings.playPosition === "current" ? clampPosition(requestedPosition) : 0;

	await fetch(`${baseUrl}/stop`, {
		method: "POST",
		headers: {
			Authorization: AIRPLAY_AUTH_HEADER
		}
	}).catch(() => undefined);

	const response = await fetch(`${baseUrl}/play`, {
		method: "POST",
		headers: {
			Authorization: AIRPLAY_AUTH_HEADER,
			"Content-Type": "text/parameters"
		},
		body: `Content-Location: ${url}\nStart-Position: ${startPosition}\n`
	});

	if (!response.ok) {
		throw new Error(`AirPlay device rejected the request (${response.status}).`);
	}
}

async function testAirPlayTarget() {
	const settings = await getSettings();
	const baseUrl = buildAirPlayBaseUrl(settings.hostname);

	try {
		const response = await fetch(`${baseUrl}/server-info`, {
			method: "GET",
			headers: {
				Authorization: AIRPLAY_AUTH_HEADER
			}
		});

		if (!response.ok) {
			return { ok: false, error: `Receiver responded with ${response.status}.` };
		}

		return { ok: true };
	} catch {
		return {
			ok: false,
			error: "Could not reach the configured AirPlay receiver. Check the hostname or IP and confirm the receiver is on the same network."
		};
	}
}

async function playOnChromecast(url, requestedPosition, contentType = "") {
	if (!url) {
		throw new Error("No video URL was provided.");
	}

	if (!isDirectMediaCandidate(url, contentType)) {
		throw new Error(
			"Hurl can only forward direct media URLs to Chromecast. DRM, blob, and protected streams cannot be remuxed by the extension."
		);
	}

	const settings = await getSettings();
	const startPosition = settings.playPosition === "current" ? clampPosition(requestedPosition) : 0;
	const response = await fetch(`${settings.castBridgeUrl}/cast`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			url,
			position: startPosition,
			contentType: String(contentType || ""),
			deviceName: settings.castDeviceName || undefined
		})
	});

	if (!response.ok) {
		let detail = "";
		try {
			detail = (await response.text()).trim();
		} catch {
			detail = "";
		}
		throw new Error(detail || `Chromecast bridge rejected the request (${response.status}).`);
	}
}

async function testChromecastBridge() {
	const settings = await getSettings();
	try {
		const response = await fetch(`${settings.castBridgeUrl}/health`, { method: "GET" });
		if (!response.ok) {
			return { ok: false, error: `Bridge responded with ${response.status}.` };
		}
		return { ok: true };
	} catch {
		return {
			ok: false,
			error: "Could not reach the Chromecast bridge. Start the local bridge app and verify the URL in settings."
		};
	}
}

function clampPosition(position) {
	if (!Number.isFinite(position)) {
		return 0;
	}
	return Math.min(1, Math.max(0, position));
}

async function notify(title, message) {
	await chrome.notifications.create({
		type: "basic",
		iconUrl: "icon.png",
		title,
		message
	});
}
