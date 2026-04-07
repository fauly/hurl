const MEDIA_PATH_RE = /\.(m3u8|mp4|m4v|mov|webm|mpd|ogv|ogg)(?:$|[?#])/i;
const INTERCEPT_ATTR = "data-cp-net";
const INTERCEPT_EVENT = "hurl:net";
const interceptedStreamUrls = new Set();
const schedulePageMediaReport = debounce(reportPageMedia, 250);

startReporting();

function startReporting() {
	try {
		const stored = document.documentElement.getAttribute(INTERCEPT_ATTR);
		if (stored) {
			for (const rawUrl of JSON.parse(stored)) {
				const url = sanitizeInterceptedUrl(rawUrl);
				if (url) {
					interceptedStreamUrls.add(url);
				}
			}
		}
	} catch {}

	document.documentElement.addEventListener(INTERCEPT_EVENT, (event) => {
		const url = sanitizeInterceptedUrl(event?.detail);
		if (url) {
			interceptedStreamUrls.add(url);
			schedulePageMediaReport();
		}
	});

	schedulePageMediaReport();

	const observer = new MutationObserver(() => {
		schedulePageMediaReport();
	});
	observer.observe(document.documentElement || document, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["src"]
	});

	for (const eventName of ["play", "playing", "loadedmetadata", "loadeddata", "emptied", "pause"]) {
		document.addEventListener(eventName, schedulePageMediaReport, true);
	}

	window.addEventListener("load", schedulePageMediaReport, { once: true });
	document.addEventListener("visibilitychange", schedulePageMediaReport);
}

async function reportPageMedia() {
	try {
		await chrome.runtime.sendMessage({
			type: "REPORT_PAGE_MEDIA",
			candidates: [...collectVideoCandidates(), ...buildInterceptCandidates()]
		});
	} catch {}
}

function sanitizeInterceptedUrl(value) {
	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed = new URL(value, location.href);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return null;
		}
		return parsed.href;
	} catch {
		return null;
	}
}

function buildInterceptCandidates() {
	return [...interceptedStreamUrls].map((url) => ({
		id: `intercept:${url}`,
		source: "network-intercept",
		title: url.split("/").filter(Boolean).pop()?.split("?")[0] || "HLS stream",
		pageTitle: document.title,
		url,
		delivery: /\.mpd([?#]|$)/i.test(url) ? "dash" : "hls",
		directPlayable: true,
		position: 0,
		duration: null,
		contentType: /\.mpd([?#]|$)/i.test(url) ? "application/dash+xml" : "application/x-mpegURL"
	}));
}

function collectVideoCandidates(rootDocument = document, results = [], seenUrls = new Set()) {
	const videos = Array.from(rootDocument.querySelectorAll("video"));

	videos.forEach((video, index) => {
		const elementId = ensureElementId(video, index);
		const sourceUrls = getSourceUrls(video);
		const position = getCurrentPosition(video);
		const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
		const baseCandidate = {
			elementId,
			source: "page",
			title: getVideoLabel(video),
			pageTitle: document.title,
			position,
			duration
		};

		if (sourceUrls.length === 0 && video.currentSrc && !seenUrls.has(video.currentSrc)) {
			seenUrls.add(video.currentSrc);
			results.push({
				...baseCandidate,
				id: `page:${elementId}:blob`,
				url: video.currentSrc,
				delivery: "blob",
				directPlayable: false
			});
			return;
		}

		sourceUrls.forEach((url, sourceIndex) => {
			if (seenUrls.has(url)) {
				return;
			}

			seenUrls.add(url);
			results.push({
				...baseCandidate,
				id: `page:${elementId}:${sourceIndex}`,
				url,
				delivery: inferDelivery(url),
				directPlayable: isDirectMediaUrl(url)
			});
		});
	});

	const iframes = Array.from(rootDocument.querySelectorAll("iframe"));
	iframes.forEach((iframe) => {
		try {
			if (iframe.contentDocument) {
				collectVideoCandidates(iframe.contentDocument, results, seenUrls);
			}
		} catch {}
	});

	return results;
}

function ensureElementId(video, index) {
	if (!video.dataset.hurlId) {
		const randomPart = typeof crypto?.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now()}-${index}`;
		video.dataset.hurlId = `hurl-${randomPart}`;
	}

	return video.dataset.hurlId;
}

function getSourceUrls(video) {
	const candidates = new Set();
	const possibleUrls = [video.currentSrc, video.src];

	Array.from(video.querySelectorAll("source[src]"))
		.map((source) => source.src)
		.forEach((src) => possibleUrls.push(src));

	possibleUrls
		.filter(Boolean)
		.map((value) => value.trim())
		.forEach((url) => candidates.add(url));

	return [...candidates];
}

function getCurrentPosition(video) {
	if (!Number.isFinite(video.currentTime) || !Number.isFinite(video.duration) || video.duration <= 0) {
		return 0;
	}

	return Math.min(1, Math.max(0, video.currentTime / video.duration));
}

function getVideoLabel(video) {
	const directLabel =
		video.getAttribute("title") ||
		video.getAttribute("aria-label") ||
		video.getAttribute("alt") ||
		video.dataset.title;

	if (directLabel) {
		return directLabel.trim();
	}

	const ancestorHeading = video.closest("figure, article, section, main, div")
		?.querySelector("h1, h2, h3, h4, [data-title], .title");

	if (ancestorHeading?.textContent) {
		return ancestorHeading.textContent.trim();
	}

	return document.title || "Detected video";
}
function isDirectMediaUrl(url) {
	if (!url || url.startsWith("blob:") || url.startsWith("data:")) {
		return false;
	}

	try {
		const parsed = new URL(url, location.href);
		return ["http:", "https:"].includes(parsed.protocol) && MEDIA_PATH_RE.test(parsed.href);
	} catch {
		return false;
	}
}

function inferDelivery(url) {
	if (url.startsWith("blob:")) {
		return "blob";
	}
	if (/\.m3u8(?:$|[?#])/i.test(url)) {
		return "hls";
	}
	if (/\.mpd(?:$|[?#])/i.test(url)) {
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
function debounce(fn, waitMs) {
	let timeoutId;
	return () => {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			fn();
		}, waitMs);
	};
}
