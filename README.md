## Hurl

A Chrome extension that spots video URLs in your current tab and lets you stream them to any AirPlay receiver.

===

### Chrome Web Store Description

Hurl watches the page you’re on for compatible video URLs and lets you send them straight to an AirPlay receiver—like Apple TV or HomePod. It works best with direct media links (think MP4 files or HLS streams). AirPlay controls stay right in the popup for quick use while you keep browsing.

### Requirements

- Chrome 121 or newer
- An AirPlay receiver (Apple TV, HomePod, or any compatible device) on the same Wi-Fi

### Setup

1. Head to chrome://extensions, flip Developer mode on, hit Load unpacked, and pick this folder.
2. Click the Hurl icon, find Settings.
3. Type in your receiver’s hostname or IP, then save. Or just hit Scan to let Hurl look for receivers on your network.

### How to Use

1. Play a video on any streaming page.
2. Open the Hurl popup.
3. Pick "Send to AirPlay" on any compatible source it finds.

### Notes

- Videos show up in the popup after the page starts playing them. So get playback going before you open the extension.
- Hurl only works with direct video URLs. If a site uses blob streams, DRM, or some custom player, Hurl won’t be able to hand those off.
- Sites like YouTube usually hide the real video URL, so Hurl might show the stream but can’t send it to AirPlay.

### Privacy

Hurl scans just the current page and its network requests to find video URLs you can send to AirPlay. It doesn’t track your browsing, collect account info, or send any content away for analysis. When you look for AirPlay receivers, that scan stays local, and any info you enter is saved only to your Chrome.

### Permission Details

- activeTab: Pulls media from the tab you’re currently viewing, right when the popup opens.
- contextMenus: Lets you right-click a video or link and send it to AirPlay without opening the popup.
- notifications: Pings you when context-menu sends succeed or fail.
- storage: Saves your AirPlay settings and preferences in Chrome.
- tabs: Keeps track of which media it’s found in each tab and keeps things tidy.
- webRequest: Checks network headers to spot direct video files and playlists on different sites.
- host_permissions with <all_urls>: Needed because videos show up all over the web, not just a set list of sites.
- content_scripts on <all_urls>: Lets Hurl peek at video elements on the page and catch in-page sources if the network-level scan misses something.