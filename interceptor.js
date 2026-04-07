(function () {
	"use strict";

	const ATTR = "data-cp-net";
	const EVENT = "hurl:net";

	function isMediaManifest(url) {
		if (!url || typeof url !== "string") {
			return false;
		}
		return (
			/\.(m3u8|mpd)([?#]|$)/i.test(url) ||
			/[/?=&]m3u8([?&#/]|$)/i.test(url) ||
			/[/?=&]master\.m3u8/i.test(url)
		);
	}

	function resolveUrl(url) {
		if (!url) {
			return null;
		}
		try {
			return /^https?:\/\//i.test(url) ? url : new URL(url, location.href).href;
		} catch {
			return null;
		}
	}

	function captureUrl(rawUrl) {
		const url = resolveUrl(rawUrl);
		if (!url) {
			return;
		}
		try {
			const stored = document.documentElement.getAttribute(ATTR);
			const arr = stored ? JSON.parse(stored) : [];
			if (!arr.includes(url)) {
				arr.push(url);
				document.documentElement.setAttribute(ATTR, JSON.stringify(arr));
			}
		} catch {}
		try {
			document.documentElement.dispatchEvent(new CustomEvent(EVENT, { detail: url }));
		} catch {}
	}

	const _fetch = window.fetch;
	window.fetch = function (resource, init) {
		try {
			const url =
				typeof resource === "string"
					? resource
					: resource instanceof URL
					? resource.href
					: resource?.url ?? "";
			if (isMediaManifest(url)) {
				captureUrl(url);
			}
		} catch {}
		return _fetch.apply(this, arguments);
	};

	const _open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url) {
		try {
			if (isMediaManifest(String(url ?? ""))) {
				captureUrl(String(url));
			}
		} catch {}
		return _open.apply(this, arguments);
	};
})();
