## Hurl

A Chrome extension that detects compatible video URLs on the current tab and sends them to an AirPlay receiver.

### Requirements

- Chrome 121 or later
- An AirPlay receiver (Apple TV, HomePod, or compatible device) on the same network

### Setup

1. Go to chrome://extensions, enable Developer mode, click Load unpacked, and select this folder.
2. Click the Hurl icon, then Settings.
3. Enter your AirPlay receiver hostname or IP address and save. You can use Scan to look for receivers on your local network.

### Using it

1. Start playback on any streaming page.
2. Open the Hurl popup.
3. Click Send to AirPlay on any compatible detected source.

### Notes

- Detected streams appear after the page starts loading them, so open the popup after playback starts.
- Hurl can only send direct media URLs to AirPlay. Browser-managed blob streams, DRM-protected playback, and some site-specific players cannot be handed off.
- YouTube and similar sites often expose blob-backed playback rather than a direct URL, so Hurl will show the stream but not offer AirPlay for it.