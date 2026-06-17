import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- fundo preto -->
  <rect width="1024" height="1024" fill="#0A0A0A"/>

  <!-- letra K - barra vertical esquerda em dourado -->
  <rect x="200" y="160" width="110" height="480" fill="#D4860A"/>

  <!-- diagonal superior (prata) -->
  <polygon points="310,160 620,160 620,280 310,370" fill="#A8A8A8"/>

  <!-- diagonal inferior (prata) -->
  <polygon points="310,450 620,640 620,760 310,640" fill="#A8A8A8"/>

  <!-- arco dourado decorativo -->
  <path d="M 160 680 Q 512 580 860 680" stroke="#D4860A" stroke-width="8" fill="none"/>

  <!-- texto KESHER -->
  <text x="512" y="780" font-family="Arial Black, Arial, sans-serif" font-size="120" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="12">KESHER</text>

  <!-- tagline -->
  <text x="512" y="840" font-family="Arial, sans-serif" font-size="32" fill="#D4860A" text-anchor="middle" letter-spacing="3">CONECTANDO QUEM CONSTRÓI O FUTURO.</text>
</svg>`;

async function generateForApp(outputDir) {
  const buf = Buffer.from(svgIcon);

  await sharp(buf).resize(1024, 1024).png().toFile(join(outputDir, 'icon.png'));
  console.log(`  icon.png`);

  const svgForeground = svgIcon.replace('fill="#0A0A0A"', 'fill="transparent"');
  await sharp(Buffer.from(svgForeground)).resize(1024, 1024).png().toFile(join(outputDir, 'adaptive-icon.png'));
  console.log(`  adaptive-icon.png`);

  await sharp(buf).resize(1024, 1024).png().toFile(join(outputDir, 'splash-icon.png'));
  console.log(`  splash-icon.png`);

  await sharp(buf).resize(48, 48).png().toFile(join(outputDir, 'favicon.png'));
  console.log(`  favicon.png`);
}

async function generate() {
  const apps = [
    join(__dirname, '../apps/mobile-client/assets'),
    join(__dirname, '../apps/mobile-provider/assets'),
  ];

  for (const outputDir of apps) {
    const appName = outputDir.includes('provider') ? 'mobile-provider' : 'mobile-client';
    console.log(`\nGerando ícones para ${appName}...`);
    await generateForApp(outputDir);
  }

  console.log('\nTodos os ícones gerados com sucesso!');
}

generate().catch(console.error);
