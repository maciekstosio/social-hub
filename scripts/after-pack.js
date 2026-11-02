// Flips Electron fuses on the packaged app: encrypt cookies (session logins)
// with the OS keychain and disable ways to run the binary as a plain Node.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const name = packager.appInfo.productFilename;
  const binary =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${name}.app`)
      : path.join(appOutDir, electronPlatformName === 'win32' ? `${name}.exe` : name);

  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
};
