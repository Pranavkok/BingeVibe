# BingeVibe

Watch YouTube Shorts while you vibe code. BingeVibe opens a side panel in VS Code/Cursor that plays YouTube Shorts so you can stay entertained without leaving your editor.

## Features

- **YouTube Shorts player** — search for any topic and watch Shorts in a VS Code panel
- **Seamless navigation** — Next/Prev buttons to scroll through videos with full sound
- **Auto-skip** — non-embeddable videos are automatically skipped
- **Unlimited scroll** — endless videos with automatic pagination via YouTube Data API

## Requirements

A **YouTube Data API v3 key** is required. You'll be prompted to enter it when you first run the extension.

## Usage

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **BingeVibe: Watch Shorts**
3. Enter a search query (e.g. "lofi music", "coding tips")
4. A side panel opens with Shorts — click **🔇 Tap for sound** on the first video to unmute

## Extension Settings

- `bingevibe.apiKey` — Your YouTube Data API v3 key

## Known Issues

- YouTube Shorts require a valid API key with the YouTube Data API v3 enabled
- Some videos may be skipped if they are not embeddable

## Release Notes

### 0.0.1

Initial release — YouTube Shorts side panel with search, navigation, and auto-skip.
