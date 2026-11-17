import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { CONFIG_FILENAME, ConfigError, loadConfig, mergeConfig, withDefaultSources } from '../config/load.js';
import type { LeakLensConfigInput } from '../config/schema.js';
import { scan } from '../core/pipeline.js';
import { SEVERITY_ORDER, type ScanResult, type Severity } from '../core/types.js';
import { readBaseline, writeBaseline } from '../policy/baseline.js';
import { SEVERITY_LABEL, LOCATION_LABEL } from '../reporters/labels.js';
import { writeReports, type ReportFormat } from '../reporters/index.js';
import { VERSION } from '../version.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const red = c('31');
const yellow = c('33');
const green = c('32');
const cyan = c('36');
const SEV_COLOR: Record<Severity, (s: string) => string> = {
  critical: c('1;31'),
  high: red,
  medium: yellow,
  low: cyan,
  info: dim,
};

const list = (v: string, prev: string[] = []) => prev.concat(v.split(',').map((s) => s.trim()).filter(Boolean));

interface ScanFlags {
  config?: string;
  har?: string[];
  trace?: string[];
  newman?: string[];
  logs?: string[];
  bundles?: string[];
  images?: string[];
  countries?: string[];
  failOn?: string;
  out?: string;
  format?: string[];
  baseline?: string | false;
  ocr?: boolean;
  quiet?: boolean;
}

function addScanOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <archivo>', `archivo de configuración (por defecto ./${CONFIG_FILENAME})`)
    .option('--har <glob>', 'archivos HAR (se puede repetir o separar por comas)', list)
    .option('--trace <glob>', 'trazas de Playwright (trace.zip)', list)
    .option('--newman <glob>', 'reportes JSON de Newman', list)
    .option('--logs <glob>', 'logs de aplicación o consola de Jenkins', list)
    .option('--bundles <glob>', 'bundles de LeakLens (Playwright, Cypress, Selenium)', list)
    .option('--images <glob>', 'capturas de pantalla para OCR (requiere --ocr)', list)
    .option('--countries <lista>', 'países para documentos de identidad: pe,co', list)
    .addOption(new Option('--fail-on <severidad>', 'severidad mínima que rompe el build').choices([...SEVERITY_ORDER, 'none']))
    .option('-o, --out <dir>', 'carpeta de reportes')
    .option('-f, --format <lista>', 'formatos: html,json,sarif,junit', list)
    .option('--baseline <archivo>', 'archivo de baseline')
    .option('--no-baseline', 'ignora el baseline')
    .option('--ocr', 'activa el OCR de capturas (requiere tesseract.js)')
    .option('-q, --quiet', 'solo imprime el resumen final');
}

function buildConfig(flags: ScanFlags) {
  const { config, baseDir } = loadConfig(flags.config);
  const override: LeakLensConfigInput = {
    sources: {
      har: flags.har,
      trace: flags.trace,
      newman: flags.newman,
      logs: flags.logs,
      bundles: flags.bundles,
      images: flags.images,
    },
    countries: flags.countries as LeakLensConfigInput['countries'],
    failOn: flags.failOn as LeakLensConfigInput['failOn'],
    baseline: flags.baseline,
    output: { dir: flags.out, formats: flags.format as ReportFormat[] | undefined },
    ocr: flags.ocr ? { enabled: true } : undefined,
  };
  // Las rutas de la CLI son relativas al directorio actual, no al del archivo de configuración.
  const cliSources = Object.values(override.sources ?? {}).some((v) => v && v.length);
  const merged = withDefaultSources(mergeConfig(config, override));
  return { config: merged, baseDir: cliSources ? process.cwd() : baseDir, outBase: flags.out ? process.cwd() : baseDir };
}

function printSummary(result: ScanResult, files: string[], quiet: boolean) {
  const s = result.stats;
  const newOnes = result.findings.filter((f) => f.status === 'new');
  if (!quiet && newOnes.length) {
    console.log('');
    for (const f of newOnes.slice(0, 25)) {
      const sev = SEV_COLOR[f.severity](SEVERITY_LABEL[f.severity].padEnd(7));
      const where = [LOCATION_LABEL[f.location], f.endpoint, f.fieldPath].filter(Boolean).join(' · ');
      const tags = f.tags.includes('sobreexpuesto') ? yellow(' [sobreexpuesto]') : '';
      console.log(`  ${sev} ${bold(f.title)}${f.kind ? dim(` (${f.kind})`) : ''} ${f.masked}${tags}`);
      console.log(`          ${dim(where)}`);
    }
    if (newOnes.length > 25) console.log(dim(`  … y ${newOnes.length - 25} más en el reporte`));
  }
  console.log('');
  const counts = [...SEVERITY_ORDER]
    .reverse()
    .map((sev) => `${SEV_COLOR[sev as Severity](String(s.newBySeverity[sev as Severity]))} ${SEVERITY_LABEL[sev as Severity].toLowerCase()}`)
    .join(' · ');
  console.log(`  ${bold('Nuevos:')} ${counts}`);
  console.log(dim(`  En baseline: ${s.byStatus.baselined} · Aceptados: ${s.byStatus.allowed} · Evidencias: ${s.evidences} · ${(result.durationMs / 1000).toFixed(1)} s`));
  for (const e of result.errors) console.log(red(`  ✖ ${e.file}: ${e.message}`));
  for (const w of result.warnings) console.log(yellow(`  ! ${w}`));
  for (const f of files) console.log(dim(`  → ${path.relative(process.cwd(), f)}`));
  console.log('');
  if (result.failed) {
    console.log(red(bold(`  ✖ LeakLens: hay hallazgos nuevos de severidad ${SEVERITY_LABEL[result.failOn as Severity].toLowerCase()} o mayor.`)));
  } else {
    console.log(green(bold('  ✔ LeakLens: sin hallazgos nuevos sobre el umbral.')));
  }
  console.log('');
}

async function runScan(flags: ScanFlags): Promise<number> {
  const { config, baseDir, outBase } = buildConfig(flags);
  if (!flags.quiet) console.log(bold(`\n  LeakLens ${VERSION}`) + dim('  · analizando lo que tus pruebas ya vieron'));
  const result = await scan({
    config,
    baseDir,
    onFile: flags.quiet ? undefined : (kind, file) => console.log(dim(`  ${kind.padEnd(7)} ${path.relative(process.cwd(), file)}`)),
  });
  const files = writeReports(result, path.resolve(outBase, config.output.dir), config.output.formats);
  printSummary(result, files, !!flags.quiet);
  return result.failed ? 1 : 0;
}

async function runBaseline(flags: ScanFlags): Promise<number> {
  const { config, baseDir } = buildConfig({ ...flags, baseline: undefined });
  const file = path.resolve(baseDir, flags.baseline || config.baseline || '.leaklens-baseline.json');
  const previous = readBaseline(file);
  const result = await scan({ config: { ...config, baseline: false }, baseDir });
  const n = writeBaseline(file, result.findings, previous);
  console.log(green(`\n  ✔ Baseline guardado con ${n} hallazgo(s) en ${path.relative(process.cwd(), file)}`));
  console.log(dim('  Desde ahora, el build solo falla por hallazgos nuevos. Versiona este archivo junto con tus pruebas.\n'));
  return 0;
}

function runInit(force: boolean): number {
  const file = path.resolve(CONFIG_FILENAME);
  if (existsSync(file) && !force) {
    console.error(yellow(`  Ya existe ${CONFIG_FILENAME}. Usa --force para sobrescribirlo.`));
    return 2;
  }
  const template = {
    sources: {
      har: ['test-results/**/*.har'],
      trace: ['test-results/**/trace.zip'],
      bundles: ['test-results/**/leaklens.bundle.json', 'cypress/leaklens/**/leaklens.bundle.json'],
      newman: ['newman/**/*.json'],
      logs: [],
      images: [],
    },
    countries: ['pe', 'co'],
    failOn: 'high',
    baseline: '.leaklens-baseline.json',
    output: { dir: 'leaklens-report', formats: ['html', 'json', 'sarif', 'junit'] },
    allowlist: [],
    customDetectors: [],
    ocr: { enabled: false, lang: 'spa+eng' },
  };
  writeFileSync(file, JSON.stringify(template, null, 2) + '\n');
  console.log(green(`  ✔ Creado ${CONFIG_FILENAME}`));
  console.log(dim('  Siguiente paso: npx leaklens scan'));
  return 0;
}

const program = new Command()
  .name('leaklens')
  .description('Detecta datos sensibles que tus pruebas E2E y de API ya están viendo.')
  .version(VERSION, '-v, --version')
  // Flags inválidos son errores de configuración: salida 2, no 1 (1 = hay fugas).
  .exitOverride((err) => process.exit(err.exitCode === 0 ? 0 : 2));

addScanOptions(program.command('scan', { isDefault: true }).description('analiza las fuentes y genera los reportes')).action(
  async (flags: ScanFlags) => exit(await runScan(flags)),
);

addScanOptions(program.command('baseline').description('acepta los hallazgos actuales como conocidos (solo fallarán los nuevos)')).action(
  async (flags: ScanFlags) => exit(await runBaseline(flags)),
);

program
  .command('init')
  .description(`crea ${CONFIG_FILENAME} con valores recomendados`)
  .option('--force', 'sobrescribe si ya existe')
  .action((flags: { force?: boolean }) => exit(runInit(!!flags.force)));

function exit(code: number) {
  process.exitCode = code;
}

program.parseAsync().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(red(`\n  ${err.message}\n`));
  else console.error(red(`\n  LeakLens falló: ${(err as Error)?.stack ?? err}\n`));
  process.exitCode = 2;
});
