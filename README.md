## Hurl

A Chrome extension that finds video streams on the current tab and sends them to AirPlay or Chromecast targets.

### Requirements

- Chrome 121 or later
- An AirPlay receiver (Apple TV, HomePod, or compatible device) on the same network
- For Chromecast support, a local bridge service running on your machine

### Setup

1. Go to chrome://extensions, enable Developer mode, click Load unpacked, and select this folder.
2. Click the Hurl icon, then Settings.
3. Enter your AirPlay receiver's IP address and save. Use Scan to find it automatically.
4. Optional: set Chromecast bridge URL and preferred Chromecast device name.

### Using it

1. Start playback on any streaming page.
2. Open the Hurl popup.
3. Click Send to AirPlay or Send to Chromecast on any detected source.

### Notes

- AirPlay and Chromecast bridge flows work only with direct media URLs (MP4/HLS/DASH/WebM). Blob/DRM streams cannot be sent.
- Detected streams appear after the page starts loading them, so open the popup after playback starts.
- The Cast button is only available on pages that expose the browser Remote Playback API.

### Chromecast Bridge Contract

The extension calls a local HTTP bridge (default `http://127.0.0.1:47991`) with these endpoints:

- `GET /health` returns `200 OK` when the bridge is reachable.
- `POST /cast` with JSON body:

```json
{
	"url": "https://example.com/video.m3u8",
	"position": 0.25,
	"contentType": "application/vnd.apple.mpegurl",
	"deviceName": "Living Room TV"
}
```

### Miracast

Miracast is OS-level screen mirroring rather than a web receiver protocol. Hurl cannot directly start Miracast sessions from extension code. Use your OS screen-mirroring flow for Miracast targets.
