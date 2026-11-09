# 0.7.0

- Added a Windows installer and in-app updates, with a compact download button that turns green when an update is available.
- Added a private test trackpad: move or click to control a test user's pointer in your selected shared area. Includes separate signaling-relay and WebRTC-peer indicators.
- Kept both windows fixed, with startup sizing that fits the content and display scale.
- Reduced the Windows package by removing duplicate frontend dependencies, unused locales, and native files for other platforms.
- Allowed manually entered secrets with at least six characters, excluding spaces and hyphens from the count. Randomly generated secrets remain unchanged.
- Fixed cursor calibration for displays positioned to the left of or above the primary display.

## Installing

Existing portable ZIP users must install this version once. Future installer releases can update through the application. This release is unsigned, so Windows may display a SmartScreen warning.
