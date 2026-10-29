import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const tauriConfPath = path.join(__dirname, 'src-tauri', 'tauri.conf.json');
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  const version = tauriConf.version;

  const nsisDir = path.join(__dirname, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const exeName = `cctv-viewer_${version}_x64-setup.exe`;
  const sigName = `${exeName}.sig`;
  const sigPath = path.join(nsisDir, sigName);

  if (!fs.existsSync(sigPath)) {
    console.error(`[ERROR] No se encontro la firma: ${sigPath}`);
    process.exit(1);
  }

  const signature = fs.readFileSync(sigPath, 'utf8').trim();
  const downloadUrl = `https://github.com/joseward/CCTV-JOSE/releases/download/v${version}/${exeName}`;

  const manifest = {
    version: version,
    notes: `Actualización automática de CCTV Unified Monitor versión ${version}.`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: signature,
        url: downloadUrl
      },
      "windows-x86_64-nsis": {
        signature: signature,
        url: downloadUrl
      }
    }
  };

  const manifestPath = path.join(nsisDir, 'latest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n======================================================');
  console.log('✓ MANIFIESTO DE ACTUALIZACION GENERADO CON EXITO:');
  console.log(`  ${manifestPath}`);
  console.log('======================================================');
  console.log(`Version:    v${version}`);
  console.log(`Descarga:   ${downloadUrl}`);
  console.log('======================================================\n');
} catch (err) {
  console.error('Error generando latest.json:', err);
  process.exit(1);
}
