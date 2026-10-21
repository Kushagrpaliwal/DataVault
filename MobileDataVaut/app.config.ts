// @ts-nocheck
import { defineConfig } from '@lynx-js/rspeedy'
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import type { AppConfig } from 'sparkling-app-cli'

const lynxConfig = defineConfig({
  source: {
    entry: {
      main: './src/pages/main/index.tsx',
    },
  },
  output: {
    assetPrefix: 'asset:///',
    filename: {
      bundle: '[name].lynx.bundle'
    },
  },
  dev: {
    assetPrefix: true,
  },
  server: {
    port: 5969,
    strictPort: true,
  },
  plugins: [
    pluginQRCode({
      schema(url: string): string {
        // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
        return `${url}?fullscreen=true`
      },
    }),
    pluginReactLynx(),
  ],
})

const config: AppConfig = {
  lynxConfig,
  appName: 'DataVault',
  platform: {
    android: {
      packageName: 'com.datavault.mobile',
    },
    ios: {
      bundleIdentifier: 'com.datavault.mobile',
    },
  },
  paths: {
    androidAssets: 'android/app/src/main/assets',
    iosAssets: 'ios/SparklingGo/SparklingGo/Resources/Assets',
  },
  appIcon: './resource/app_icon.png',
  router: {
    main: {
      path: './lynxPages/main',
    },
  },
  plugin: [
    [
      'splash-screen',
      {
        backgroundColor: '#fffaf0',
        image: './resource/app_icon.png',
        dark: {
          image: './resource/app_icon.png',
          backgroundColor: '#fffaf0',
        },
        imageWidth: 200,
      },
    ],
  ],
};

export default config
