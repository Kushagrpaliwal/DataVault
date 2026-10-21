# DataVault Mobile

Native iOS and Android client for the existing DataVault API, built with Lynx, Sparkling, and Bun.

## Development

1. Install Bun 1.4 or newer.
2. Copy `.env.example` to `.env` and set `VITE_API_URL` to the reachable API origin.
3. Run `bun install`.
4. Run `bun run typecheck` and `bun run test`.
5. Run `bun run build` to produce the Lynx bundle. Use `bun run build:copy` when native asset copies are required.

## LynxExplorer Preview

This is the fastest way to preview the app without Expo, Java, the Android SDK, or Android Studio.

1. Install [Lynx Go Dev Explorer](https://play.google.com/store/apps/details?id=com.funcs.io.lynx.go) on an Android phone. The Android build is maintained by community contributors.
2. Start the existing API from the repository root in a separate terminal:

   ```powershell
   bun run dev:api
   ```

3. Find the computer's private IPv4 address with `ipconfig`, then set the API origin from this app directory. Replace the address with the computer's LAN address:

   ```powershell
   $env:VITE_API_URL = "http://192.168.1.50:3000"
   bun run dev
   ```

4. Keep the phone and computer on the same Wi-Fi network. Scan the QR code printed by the dev server in Lynx Go Dev Explorer. The app uses port `5969` for the Lynx bundle and port `3000` for the API.

If the phone cannot connect, allow Node/Bun through the Windows private-network firewall and verify that both ports are reachable from the phone.

The Explorer preview covers Lynx UI and API behavior. Native secure storage and Sparkling-native router behavior still require the Android shell.

Android builds require Node 22 or 24, Java 11, and the Android SDK. iOS builds require macOS, Xcode, and CocoaPods.

The app uses the existing email/password cookie session routes and sends the session-derived CSRF token on mutations. No mobile-specific backend or bearer-token flow is added.

For an Android emulator, a local API is normally reachable at `http://10.0.2.2:3000`; iOS Simulator can use `http://localhost:3000`. Physical devices need a LAN-reachable API origin.
