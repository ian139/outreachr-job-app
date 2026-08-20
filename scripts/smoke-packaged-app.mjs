#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCleanupErrors,
  nsisUninstallArgs,
  parseArgs,
  repoRoot,
  run,
  runExecutable,
  throwCleanupErrors,
  throwWithCleanup,
  walkFiles,
} from './_lib.mjs';

export function parseSmokeArgs(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  const hasDmg = args.dmg !== undefined && args.dmg !== false;
  const hasZip = args.zip !== undefined && args.zip !== false;

  if (hasDmg && hasZip) {
    throw new Error('Cannot specify both --dmg and --zip options.');
  }

  let kind = args.kind?.toLowerCase();
  let dmgPath;
  let zipPath;

  if (typeof args.dmg === 'string') {
    dmgPath = path.resolve(args.dmg);
    if (kind && kind !== 'dmg') {
      throw new Error(`Inconsistent --kind "${args.kind}" and --dmg option.`);
    }
    kind = 'dmg';
  } else if (hasDmg) {
    if (kind && kind !== 'dmg') {
      throw new Error(`Inconsistent --kind "${args.kind}" and --dmg option.`);
    }
    kind = 'dmg';
  }

  if (typeof args.zip === 'string') {
    zipPath = path.resolve(args.zip);
    if (kind && kind !== 'zip') {
      throw new Error(`Inconsistent --kind "${args.kind}" and --zip option.`);
    }
    kind = 'zip';
  } else if (hasZip) {
    if (kind && kind !== 'zip') {
      throw new Error(`Inconsistent --kind "${args.kind}" and --zip option.`);
    }
    kind = 'zip';
  }

  if (kind && !['dmg', 'zip', 'nsis', 'appimage', 'deb'].includes(kind)) {
    throw new Error(`Invalid distribution kind "${kind}". Expected "dmg" or "zip".`);
  }
  const arch = args.arch ?? args.architecture;
  if (arch && !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Invalid architecture "${arch}". Expected "x64" or "arm64".`);
  }
  const releaseDir = path.resolve(
    args['release-dir'] ?? path.join(repoRoot, 'apps', 'desktop', 'release'),
  );
  const timeoutMs = Number(args['timeout-ms'] ?? 120_000);
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid --timeout-ms value; expected positive integer.');
  }
  return {
    releaseDir,
    timeoutMs,
    kind,
    arch,
    dmgPath,
    zipPath,
  };
}

export async function runPackagedSmoke(options = parseSmokeArgs(), deps = {}) {
  const { timeoutMs } = options;
  const distributions = await stageDistributions(options.releaseDir, options, deps);
  let smokeError;
  try {
    for (const distribution of distributions) {
      await smokeDistribution(distribution, timeoutMs, deps);
    }
  } catch (error) {
    smokeError = error;
  }
  const cleanupErrors = await cleanupDistributions(distributions, deps);
  if (smokeError) throwWithCleanup(smokeError, cleanupErrors, 'Packaged application smoke');
  throwCleanupErrors(cleanupErrors, 'Packaged application smoke');
}

export async function executableArchitecture(executable, deps = {}) {
  if (process.platform !== 'darwin') return [];
  const runCmd = deps.run ?? run;
  try {
    const lipoResult = await runCmd('lipo', ['-info', executable], { allowFailure: true });
    if (lipoResult && lipoResult.code === 0) {
      const output = lipoResult.stdout;
      const archs = [];
      if (output.includes('x86_64')) archs.push('x64');
      if (output.includes('arm64')) archs.push('arm64');
      return archs;
    }
  } catch {
    // Ignore lipo errors fallback
  }
  return [];
}

export async function smokeDistribution(distribution, timeout, deps = {}) {
  const fileSystem = deps.fs ?? fs;
  const remTree = deps.removeTree ?? removeTree;
  const profile = await (deps.mkdtemp ?? fileSystem.mkdtemp)(
    path.join(os.tmpdir(), 'outreachr-smoke-profile-'),
  );
  let smokeError;
  let child1;
  let child2;
  try {
    // Session 1: Launch, setup workspace, create company and application record
    const debuggingPort1 = await (deps.availablePort ?? availablePort)();
    console.log(
      `Launching final ${distribution.kind} distribution (Session 1 - Creation): ${distribution.executable}`,
    );
    let stdout1 = '';
    let stderr1 = '';
    child1 = (deps.spawnProcess ?? spawnProcess)(distribution, profile, debuggingPort1, deps);
    if (child1.stdout) {
      child1.stdout.on('data', (chunk) => {
        stdout1 = `${stdout1}${chunk}`.slice(-40_000);
      });
    }
    if (child1.stderr) {
      child1.stderr.on('data', (chunk) => {
        stderr1 = `${stderr1}${chunk}`.slice(-40_000);
      });
    }

    const earlyExit1 = new Promise((_, reject) => {
      child1.once('error', reject);
      child1.once('exit', (code, signal) => {
        reject(
          new Error(
            `Session 1 application exited before readiness (code=${code}, signal=${signal})\nstdout:${stdout1}\nstderr:${stderr1}`,
          ),
        );
      });
    });

    const renderer1 = await Promise.race([
      (deps.waitForRendererReadiness ?? waitForRendererReadiness)(debuggingPort1, timeout, deps),
      earlyExit1,
    ]);

    if (child1.exitCode !== null && child1.exitCode !== undefined) {
      throw new Error('Session 1 application exited immediately after readiness');
    }

    console.log(
      JSON.stringify({
        event: 'renderer-ready',
        session: 1,
        distribution: distribution.kind,
        title: renderer1.title,
        workspace: renderer1.workspace,
        visibleTextCharacters: renderer1.bodyTextLength,
      }),
    );

    // Drive job application creation in Session 1
    const createdRecord = await (deps.driveJobApplicationCreation ?? driveJobApplicationCreation)(
      debuggingPort1,
      deps,
    );
    if (!createdRecord || !createdRecord.applicationId) {
      throw new Error('Session 1 job application creation failed to return valid record details');
    }

    console.log(
      JSON.stringify({
        event: 'application-created',
        distribution: distribution.kind,
        applicationId: createdRecord.applicationId,
        role: createdRecord.role,
        companyName: createdRecord.companyName,
      }),
    );

    // Gracefully shutdown Session 1 process
    await (deps.terminateTree ?? terminateTree)(child1.pid);
    child1 = null;

    // Session 2: Relaunch same profile, verify persisted application record
    const debuggingPort2 = await (deps.availablePort ?? availablePort)();
    console.log(
      `Relaunching final ${distribution.kind} distribution (Session 2 - Persistence Check): ${distribution.executable}`,
    );
    let stdout2 = '';
    let stderr2 = '';
    child2 = (deps.spawnProcess ?? spawnProcess)(distribution, profile, debuggingPort2, deps);
    if (child2.stdout) {
      child2.stdout.on('data', (chunk) => {
        stdout2 = `${stdout2}${chunk}`.slice(-40_000);
      });
    }
    if (child2.stderr) {
      child2.stderr.on('data', (chunk) => {
        stderr2 = `${stderr2}${chunk}`.slice(-40_000);
      });
    }

    const earlyExit2 = new Promise((_, reject) => {
      child2.once('error', reject);
      child2.once('exit', (code, signal) => {
        reject(
          new Error(
            `Session 2 application exited before readiness (code=${code}, signal=${signal})\nstdout:${stdout2}\nstderr:${stderr2}`,
          ),
        );
      });
    });

    await Promise.race([
      (deps.waitForRendererReadiness ?? waitForRendererReadiness)(debuggingPort2, timeout, deps),
      earlyExit2,
    ]);

    if (child2.exitCode !== null && child2.exitCode !== undefined) {
      throw new Error('Session 2 application exited immediately after readiness');
    }

    // Drive application persistence verification in Session 2
    const persistenceResult = await (
      deps.driveJobApplicationPersistenceCheck ?? driveJobApplicationPersistenceCheck
    )(debuggingPort2, createdRecord.applicationId, deps);

    if (
      !persistenceResult ||
      !persistenceResult.verified ||
      persistenceResult.applicationId !== createdRecord.applicationId
    ) {
      throw new Error(
        `Session 2 persistence verification failed for application ${createdRecord.applicationId}`,
      );
    }

    console.log(
      JSON.stringify({
        event: 'application-persistence-verified',
        distribution: distribution.kind,
        applicationId: persistenceResult.applicationId,
        role: persistenceResult.role,
        companyName: persistenceResult.companyName,
      }),
    );

    await (deps.terminateTree ?? terminateTree)(child2.pid);
    child2 = null;
  } catch (error) {
    smokeError = new Error(
      `${distribution.kind} smoke failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const cleanupErrors = await collectCleanupErrors([
    async () => {
      if (child1?.pid) await (deps.terminateTree ?? terminateTree)(child1.pid);
    },
    async () => {
      if (child2?.pid) await (deps.terminateTree ?? terminateTree)(child2.pid);
    },
    () => remTree(profile),
  ]);

  if (smokeError) throwWithCleanup(smokeError, cleanupErrors, `${distribution.kind} smoke`);
  throwCleanupErrors(cleanupErrors, `${distribution.kind} smoke`);
}

export function spawnProcess(distribution, profile, debuggingPort, deps = {}) {
  const spawnFn = deps.spawn ?? spawn;
  const child = spawnFn(
    distribution.executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debuggingPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--outreachr-smoke-test',
      '--disable-gpu',
    ],
    {
      env: {
        ...process.env,
        ...distribution.environment,
        OUTREACHR_SMOKE_TEST: '1',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '0',
      },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (child.stdout) child.stdout.setEncoding('utf8');
  if (child.stderr) child.stderr.setEncoding('utf8');
  return child;
}

export async function driveJobApplicationCreation(debuggingPort, deps = {}) {
  if (deps.driveJobApplicationCreation) {
    return await deps.driveJobApplicationCreation(debuggingPort, deps);
  }
  const targets = await (deps.getDevToolsTargets ?? getDevToolsTargets)(debuggingPort, deps);
  const pageTarget = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error('No page target available for CDP evaluation');

  const expression = `(async () => {
    if (!window.outreachr || typeof window.outreachr.command !== 'function') {
      throw new Error('window.outreachr command hook unavailable in packaged app');
    }
    const setup = await window.outreachr.command('workspace.setup', {
      displayName: 'Packaged Smoke Candidate',
      primaryEmail: 'smoke.candidate@local.invalid',
      stages: [
        { name: 'Applied', terminal: false },
        { name: 'Interviewing', terminal: false },
        { name: 'Offer', terminal: true },
      ],
    });
    const company = await window.outreachr.command('company.create', {
      name: 'Acme Packaging Corp',
      website: 'https://acme.local.invalid',
      location: 'San Francisco, CA',
    });
    const appliedStage = (setup.applicationStages || []).find((s) => s.name === 'Applied') || setup.applicationStages[0];
    if (!appliedStage) throw new Error('No application stages created during workspace setup');
    const application = await window.outreachr.command('application.create', {
      companyId: company.id,
      role: 'Packaged Smoke Reliability Engineer',
      stageId: appliedStage.id,
    });
    return {
      applicationId: application.id,
      companyId: company.id,
      role: application.role,
      companyName: company.name || 'Acme Packaging Corp',
    };
  })()`;

  return await (deps.evaluateCDP ?? evaluateCDP)(pageTarget.webSocketDebuggerUrl, expression, deps);
}

export async function driveJobApplicationPersistenceCheck(
  debuggingPort,
  expectedApplicationId,
  deps = {},
) {
  if (deps.driveJobApplicationPersistenceCheck) {
    return await deps.driveJobApplicationPersistenceCheck(
      debuggingPort,
      expectedApplicationId,
      deps,
    );
  }
  const targets = await (deps.getDevToolsTargets ?? getDevToolsTargets)(debuggingPort, deps);
  const pageTarget = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error('No page target available for CDP evaluation');

  const expression = `(async () => {
    if (!window.outreachr || typeof window.outreachr.command !== 'function') {
      throw new Error('window.outreachr command hook unavailable in packaged app');
    }
    const bootstrap = await window.outreachr.bootstrap();
    const appDetail = await window.outreachr.command('application.get', { id: ${JSON.stringify(expectedApplicationId)} });
    if (!appDetail || appDetail.id !== ${JSON.stringify(expectedApplicationId)}) {
      throw new Error('Persisted application record ' + ${JSON.stringify(expectedApplicationId)} + ' was not found on relaunch');
    }
    if (appDetail.role !== 'Packaged Smoke Reliability Engineer') {
      throw new Error('Persisted role mismatch: expected "Packaged Smoke Reliability Engineer", got "' + appDetail.role + '"');
    }
    return {
      verified: true,
      applicationId: appDetail.id,
      role: appDetail.role,
      companyName: appDetail.companyName || 'Acme Packaging Corp',
    };
  })()`;

  return await (deps.evaluateCDP ?? evaluateCDP)(pageTarget.webSocketDebuggerUrl, expression, deps);
}

export async function stageDistributions(root, options = {}, deps = {}) {
  const requestedKind = typeof options === 'string' ? options : options.kind;
  const requestedArch = typeof options === 'object' ? options.arch : undefined;
  const explicitDmgPath = typeof options === 'object' ? options.dmgPath : undefined;
  const explicitZipPath = typeof options === 'object' ? options.zipPath : undefined;

  const walk = deps.walkFiles ?? walkFiles;
  const runCmd = deps.run ?? run;
  const runExe = deps.runExecutable ?? runExecutable;
  const getArch = deps.executableArchitecture ?? executableArchitecture;
  const verifyBundle = deps.verifyMacAppBundle ?? verifyMacAppBundle;
  const findUniqueAppExec = deps.uniqueAppExecutable ?? uniqueAppExecutable;
  const fileSystem = deps.fs ?? fs;
  const remTree = deps.removeTree ?? removeTree;
  const platform = deps.platform ?? process.platform;

  const files = await walk(root);
  const staged = [];

  try {
    if (platform === 'darwin') {
      const stageKinds = requestedKind
        ? [requestedKind]
        : explicitDmgPath
          ? ['dmg']
          : explicitZipPath
            ? ['zip']
            : ['dmg', 'zip'];

      if (stageKinds.includes('dmg')) {
        let dmgFile = explicitDmgPath;
        if (!dmgFile) {
          let dmgs = files.filter((file) => file.toLowerCase().endsWith('.dmg'));
          if (requestedArch) {
            const archDmgs = dmgs.filter((file) =>
              path.basename(file).toLowerCase().includes(requestedArch.toLowerCase()),
            );
            if (archDmgs.length > 0) dmgs = archDmgs;
          }
          if (dmgs.length === 0) {
            throw new Error(`No DMG distribution found under ${root}`);
          }
          if (dmgs.length > 1) {
            throw new Error(
              `Expected exactly one DMG distribution under ${root}${requestedArch ? ` for arch ${requestedArch}` : ''}; found ${dmgs.length} (${dmgs.map((f) => path.basename(f)).join(', ')}). Specify --arch or explicit --dmg <path>.`,
            );
          }
          dmgFile = dmgs[0];
        }

        const mountpoint = await (deps.mkdtemp ?? fileSystem.mkdtemp)(
          path.join(os.tmpdir(), 'outreachr-dmg-'),
        );
        const installRoot = await (deps.mkdtemp ?? fileSystem.mkdtemp)(
          path.join(os.tmpdir(), 'outreachr-dmg-install-'),
        );
        let mounted = false;
        try {
          await runCmd(
            'hdiutil',
            ['attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, dmgFile],
            { capture: false, timeoutMs: 60_000 },
          );
          mounted = true;
          const mountedExecutable = await findUniqueAppExec(mountpoint, 'mounted DMG', deps);
          const mountedBundle = appBundleForExecutable(mountedExecutable);
          const installedBundle = path.join(installRoot, path.basename(mountedBundle));
          await runCmd('ditto', [mountedBundle, installedBundle], {
            capture: false,
            timeoutMs: 120_000,
          });
          await runCmd('hdiutil', ['detach', mountpoint, '-force']);
          mounted = false;
          await remTree(mountpoint);
          const installedExecutable = await findUniqueAppExec(
            installRoot,
            'DMG installation',
            deps,
          );
          await verifyBundle(installedExecutable, 'DMG installation', deps);

          if (requestedArch) {
            const archs = await getArch(installedExecutable, deps);
            if (archs.length > 0 && !archs.includes(requestedArch)) {
              throw new Error(
                `DMG executable architecture (${archs.join(',')}) does not match requested architecture ${requestedArch}`,
              );
            }
          }

          staged.push({
            kind: 'DMG installation',
            executable: installedExecutable,
            environment: {},
            async cleanup() {
              await remTree(installRoot);
            },
          });
        } catch (error) {
          const cleanups = [];
          if (mounted) {
            cleanups.push(() => runCmd('hdiutil', ['detach', mountpoint, '-force']));
          }
          cleanups.push(
            () => remTree(mountpoint),
            () => remTree(installRoot),
          );
          throwWithCleanup(error, await collectCleanupErrors(cleanups), 'DMG distribution staging');
        }
      }

      if (stageKinds.includes('zip')) {
        let zipFile = explicitZipPath;
        if (!zipFile) {
          let zips = files.filter((file) => file.toLowerCase().endsWith('.zip'));
          if (requestedArch) {
            const archZips = zips.filter((file) =>
              path.basename(file).toLowerCase().includes(requestedArch.toLowerCase()),
            );
            if (archZips.length > 0) zips = archZips;
          }
          if (zips.length === 0) {
            throw new Error(`No ZIP distribution found under ${root}`);
          }
          if (zips.length > 1) {
            throw new Error(
              `Expected exactly one ZIP distribution under ${root}${requestedArch ? ` for arch ${requestedArch}` : ''}; found ${zips.length} (${zips.map((f) => path.basename(f)).join(', ')}). Specify --arch or explicit --zip <path>.`,
            );
          }
          zipFile = zips[0];
        }

        const zipRoot = await (deps.mkdtemp ?? fileSystem.mkdtemp)(
          path.join(os.tmpdir(), 'outreachr-zip-'),
        );
        try {
          await runCmd('ditto', ['-x', '-k', zipFile, zipRoot], {
            capture: false,
            timeoutMs: 60_000,
          });
          const zippedExecutable = await findUniqueAppExec(zipRoot, 'release ZIP', deps);
          await verifyBundle(zippedExecutable, 'release ZIP', deps);

          if (requestedArch) {
            const archs = await getArch(zippedExecutable, deps);
            if (archs.length > 0 && !archs.includes(requestedArch)) {
              throw new Error(
                `ZIP executable architecture (${archs.join(',')}) does not match requested architecture ${requestedArch}`,
              );
            }
          }

          staged.push({
            kind: 'ZIP',
            executable: zippedExecutable,
            environment: {},
            async cleanup() {
              await remTree(zipRoot);
            },
          });
        } catch (error) {
          throwWithCleanup(
            error,
            await collectCleanupErrors([() => remTree(zipRoot)]),
            'ZIP distribution staging',
          );
        }
      }
      return staged;
    }

    if (platform === 'win32') {
      let installers = files.filter(
        (file) =>
          file.toLowerCase().endsWith('.exe') &&
          path.basename(file).toLowerCase().startsWith('outreachr-') &&
          !file.toLowerCase().includes('unpacked'),
      );
      if (requestedArch) {
        const archInstallers = installers.filter((file) =>
          path.basename(file).toLowerCase().includes(requestedArch.toLowerCase()),
        );
        if (archInstallers.length > 0) installers = archInstallers;
      }
      if (installers.length !== 1) {
        throw new Error(
          `Expected one final NSIS installer under ${root}, found ${installers.length}`,
        );
      }
      const installRoot = await (deps.mkdtemp ?? fileSystem.mkdtemp)(
        path.join(os.tmpdir(), 'outreachr-nsis-'),
      );
      try {
        await runExe(installers[0], ['/S', `/D=${installRoot}`], {
          capture: false,
          timeoutMs: 120_000,
        });
        const installed = (await walk(installRoot)).filter(
          (file) => path.basename(file).toLowerCase() === 'outreachr.exe',
        );
        if (installed.length !== 1) {
          throw new Error(`NSIS install produced ${installed.length} Outreachr executables`);
        }
        staged.push({
          kind: 'NSIS installer',
          executable: installed[0],
          environment: {},
          cleanup: () => cleanupNsis(installRoot, deps),
        });
      } catch (error) {
        throwWithCleanup(
          error,
          await collectCleanupErrors([() => cleanupNsis(installRoot, deps)]),
          'NSIS distribution staging',
        );
      }
      return staged;
    }

    if (platform === 'linux') {
      const stageKinds = requestedKind ? [requestedKind] : ['appimage', 'deb'];

      if (stageKinds.includes('appimage')) {
        let appImages = files.filter((file) => file.toLowerCase().endsWith('.appimage'));
        if (requestedArch) {
          const archAppImages = appImages.filter((file) =>
            path.basename(file).toLowerCase().includes(requestedArch.toLowerCase()),
          );
          if (archAppImages.length > 0) appImages = archAppImages;
        }
        if (appImages.length !== 1) {
          throw new Error(`Expected one AppImage under ${root}, found ${appImages.length}`);
        }
        await fileSystem.chmod(appImages[0], 0o755);
        staged.push({
          kind: 'AppImage',
          executable: appImages[0],
          environment: { APPIMAGE_EXTRACT_AND_RUN: '1' },
          async cleanup() {},
        });
      }

      if (stageKinds.includes('deb')) {
        let debs = files.filter((file) => file.toLowerCase().endsWith('.deb'));
        if (requestedArch) {
          const archDebs = debs.filter((file) =>
            path.basename(file).toLowerCase().includes(requestedArch.toLowerCase()),
          );
          if (archDebs.length > 0) debs = archDebs;
        }
        if (debs.length !== 1) {
          throw new Error(`Expected one deb under ${root}, found ${debs.length}`);
        }
        await runCmd('dpkg-deb', ['--info', debs[0]], { capture: false });
        const packageName = (
          await runCmd('dpkg-deb', ['--field', debs[0], 'Package'])
        ).stdout.trim();
        if (!/^[a-z0-9][a-z0-9+.-]+$/.test(packageName)) {
          throw new Error(`Invalid deb package name: ${packageName}`);
        }
        const priorPackageStatus = await debPackageStatus(packageName, deps);
        if (priorPackageStatus !== null) {
          throw new Error(
            `Refusing to replace an existing ${packageName} package (${priorPackageStatus})`,
          );
        }
        if (await pathEntryExists('/usr/bin/outreachr', deps)) {
          throw new Error('Refusing to replace an existing /usr/bin/outreachr entry');
        }
        try {
          await runCmd(
            'sudo',
            ['apt-get', 'install', '--yes', '--no-install-recommends', debs[0]],
            {
              capture: false,
              timeoutMs: 120_000,
            },
          );
          const installedFiles = (await runCmd('dpkg', ['--listfiles', packageName])).stdout
            .split(/\r?\n/)
            .filter(Boolean);
          const installedExecutable = '/opt/Outreachr/outreachr';
          if (!installedFiles.includes(installedExecutable)) {
            throw new Error(`Installed deb does not contain ${installedExecutable}`);
          }
          const executableStat = await fileSystem.lstat(installedExecutable);
          if (!executableStat.isFile() || (executableStat.mode & 0o111) === 0) {
            throw new Error(`Installed deb executable is not runnable: ${installedExecutable}`);
          }
          const desktopEntryPath = '/usr/share/applications/outreachr.desktop';
          if (!installedFiles.includes(desktopEntryPath)) {
            throw new Error(`Installed deb does not contain ${desktopEntryPath}`);
          }
          const desktopEntry = await fileSystem.readFile(desktopEntryPath, 'utf8');
          if (!/^StartupWMClass=outreachr$/m.test(desktopEntry)) {
            throw new Error('Installed desktop entry does not match the Electron app identity');
          }
          if (!/^Icon=outreachr$/m.test(desktopEntry)) {
            throw new Error('Installed desktop entry does not use the packaged Outreachr icon');
          }
          const desktopExec = /^Exec=(.+)$/m.exec(desktopEntry)?.[1];
          if (desktopExec !== `${installedExecutable} %U`) {
            throw new Error(
              'Installed desktop entry does not launch the packaged Outreachr executable',
            );
          }
          staged.push({
            kind: 'deb',
            executable: installedExecutable,
            environment: {},
            cleanup: () => cleanupDeb(packageName, deps),
          });
        } catch (error) {
          throwWithCleanup(
            error,
            await collectCleanupErrors([() => cleanupDeb(packageName, deps)]),
            'Debian package staging',
          );
        }
      }
      return staged;
    }
    throw new Error(`Unsupported smoke-test platform ${platform}`);
  } catch (error) {
    throwWithCleanup(error, await cleanupDistributions(staged, deps), 'Distribution staging');
  }
}

export async function cleanupDistributions(distributions) {
  return await collectCleanupErrors(
    [...distributions].reverse().map((distribution) => () => distribution.cleanup()),
  );
}

export async function uniqueAppExecutable(root, label, deps = {}) {
  const walk = deps.walkFiles ?? walkFiles;
  const executables = (await walk(root)).filter((file) =>
    /Outreachr\.app\/Contents\/MacOS\/Outreachr$/.test(file),
  );
  if (executables.length !== 1)
    throw new Error(`${label} contains ${executables.length} Outreachr executables`);
  return executables[0];
}

export function appBundleForExecutable(executable) {
  const bundle = path.dirname(path.dirname(path.dirname(executable)));
  if (path.extname(bundle).toLowerCase() !== '.app') {
    throw new Error(`Executable is not inside a macOS app bundle: ${executable}`);
  }
  return bundle;
}

export async function verifyMacAppBundle(executable, label, deps = {}) {
  const runCmd = deps.run ?? run;
  await runCmd('codesign', ['--verify', '--deep', '--strict', appBundleForExecutable(executable)], {
    capture: false,
  });
  console.log(`${label} preserves a valid macOS code signature.`);
}

export async function cleanupNsis(installRoot, deps = {}) {
  const walk = deps.walkFiles ?? walkFiles;
  const runExe = deps.runExecutable ?? runExecutable;
  const remTree = deps.removeTree ?? removeTree;
  const uninstallers = (await walk(installRoot)).filter((file) =>
    /^uninstall.*\.exe$/i.test(path.basename(file)),
  );
  const cleanupErrors = await collectCleanupErrors([
    ...uninstallers.map(
      (uninstaller) => () =>
        runExe(uninstaller, nsisUninstallArgs(installRoot), {
          capture: false,
          timeoutMs: 60_000,
        }),
    ),
    () => remTree(installRoot),
  ]);
  throwCleanupErrors(cleanupErrors, 'NSIS installation');
}

export async function removeTree(target) {
  await fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 20 : 4,
    retryDelay: 250,
  });
}

export async function cleanupDeb(packageName, deps = {}) {
  const runCmd = deps.run ?? run;
  if ((await debPackageStatus(packageName, deps)) === null) return;
  await runCmd('sudo', ['dpkg', '--remove', packageName], { capture: false, timeoutMs: 60_000 });
  const status = await debPackageStatus(packageName, deps);
  if (status !== null && !['config-files', 'not-installed'].includes(status)) {
    throw new Error(`Debian package cleanup left ${packageName} in state ${status}`);
  }
}

export async function debPackageStatus(packageName, deps = {}) {
  const runCmd = deps.run ?? run;
  const result = await runCmd(
    'dpkg-query',
    ['--show', '--showformat=${db:Status-Status}', packageName],
    { allowFailure: true },
  );
  return result && result.code === 0 ? result.stdout.trim() : null;
}

export async function pathEntryExists(target, deps = {}) {
  const fileSystem = deps.fs ?? fs;
  try {
    await fileSystem.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function getDevToolsTargets(port, deps = {}) {
  if (deps.getDevToolsTargets) return await deps.getDevToolsTargets(port, deps);
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
  return await response.json();
}

export async function waitForRendererReadiness(port, timeout, deps = {}) {
  if (deps.waitForRendererReadiness) {
    return await deps.waitForRendererReadiness(port, timeout, deps);
  }
  const deadline = Date.now() + timeout;
  let lastError = 'DevTools endpoint not available';
  while (Date.now() < deadline) {
    try {
      const targets = await getDevToolsTargets(port, deps);
      for (const target of targets.filter(
        (item) => item.type === 'page' && item.webSocketDebuggerUrl,
      )) {
        const snapshot = await evaluateRendererReadiness(target.webSocketDebuggerUrl, deps);
        if (
          ['interactive', 'complete'].includes(snapshot.readyState) &&
          snapshot.title.includes('Outreachr') &&
          snapshot.rootChildCount > 0 &&
          snapshot.bodyTextLength > 40 &&
          !snapshot.loading &&
          !snapshot.error &&
          ['onboarding', 'workspace'].includes(snapshot.workspace)
        ) {
          return snapshot;
        }
        lastError = `renderer not ready: ${JSON.stringify(snapshot)}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for initialized renderer: ${lastError}`);
}

export async function evaluateRendererReadiness(webSocketUrl, deps = {}) {
  const expression = `(() => ({
    readyState: document.readyState,
    title: document.title,
    rootChildCount: document.querySelector('#root')?.childElementCount ?? 0,
    bodyTextLength: document.body?.innerText?.trim().length ?? 0,
    loading: Boolean(document.querySelector('.loading-screen')),
    error: Boolean(document.querySelector('.error-screen')),
    workspace: document.querySelector('.job-setup-shell, .onboarding-shell') ? 'onboarding' : document.querySelector('.app-shell') ? 'workspace' : 'unknown'
  }))()`;
  return await (deps.evaluateCDP ?? evaluateCDP)(webSocketUrl, expression, deps);
}

export async function evaluateCDP(webSocketUrl, expression, deps = {}) {
  if (deps.evaluateCDP) return await deps.evaluateCDP(webSocketUrl, expression, deps);
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('CDP renderer evaluation timed out'));
    }, 10_000);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(
          new Error(
            `CDP evaluation failed: ${JSON.stringify(message.error ?? message.result.exceptionDetails)}`,
          ),
        );
      } else {
        resolve(message.result?.result?.value);
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('CDP WebSocket failed'));
    });
  });
}

export async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a loopback debugging port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

export async function terminateTree(pid, deps = {}) {
  if (!pid) return;
  if (deps.terminateTree) return await deps.terminateTree(pid, deps);
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
      });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The process tree exited cleanly after SIGTERM.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseSmokeArgs();
  await runPackagedSmoke(options);
}
