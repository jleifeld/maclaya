import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LAYA_MLX_VERSION, resolvePaths } from '../src/paths';
import { BootstrapError, ensureRuntime, findUv, readMarker } from '../src/runtime/environment';

const FAKE_UV = `#!/bin/sh
echo "$@" >> "$FAKE_UV_LOG"
for last; do :; done
if [ "$1" = venv ]; then mkdir -p "$last/bin"; printf '#!/bin/sh\\n' > "$last/bin/python"; chmod +x "$last/bin/python"; fi
if [ "$1" = pip ] && [ "$FAKE_UV_FAIL" = pip ]; then echo "No solution found for laya-mlx" >&2; exit 1; fi
exit 0
`;

describe('ensureRuntime', () => {
  const originalEnv = { ...process.env };
  let dir: string;
  let uvLog: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'maclaya-env-'));
    uvLog = path.join(dir, 'uv.log');
    writeFileSync(path.join(dir, 'uv'), FAKE_UV);
    chmodSync(path.join(dir, 'uv'), 0o755);
    process.env.FAKE_UV_LOG = uvLog;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const uvCalls = () => (existsSync(uvLog) ? readFileSync(uvLog, 'utf8').trim().split('\n') : []);

  it('uses MACLAYA_PYTHON without touching uv', async () => {
    const paths = resolvePaths({ MACLAYA_HOME: dir });
    await expect(ensureRuntime({ paths, env: { MACLAYA_PYTHON: '/opt/python' } })).resolves.toBe('/opt/python');
    expect(uvCalls()).toEqual([]);
  });

  it('creates a pinned venv once and reuses it afterwards', async () => {
    const paths = resolvePaths({ MACLAYA_HOME: path.join(dir, 'home') });
    const env = { MACLAYA_UV: path.join(dir, 'uv') };
    const logs: string[] = [];
    const python = await ensureRuntime({ paths, env, log: (m) => logs.push(m) });

    expect(python).toBe(path.join(dir, 'home', 'venv', 'bin', 'python'));
    expect(uvCalls()).toEqual([
      `venv --allow-existing --python 3.12 ${paths.venv}`,
      `pip install --python ${paths.python} laya-mlx==${LAYA_MLX_VERSION}`,
    ]);
    expect(await readMarker(paths)).toMatchObject({ laya_mlx: LAYA_MLX_VERSION, python: '3.12' });
    expect(logs.join()).toContain('Setting up the Python runtime');

    await ensureRuntime({ paths, env });
    expect(uvCalls()).toHaveLength(2);
  });

  it('reinstalls when the marker belongs to another laya-mlx version', async () => {
    const paths = resolvePaths({ MACLAYA_HOME: path.join(dir, 'home') });
    const env = { MACLAYA_UV: path.join(dir, 'uv') };
    await ensureRuntime({ paths, env });
    writeFileSync(paths.runtimeMarker, JSON.stringify({ laya_mlx: '0.1.0', python: '3.12' }));
    await ensureRuntime({ paths, env });
    expect(uvCalls()).toHaveLength(4);
  });

  it('wraps uv failures with a hint and writes no marker', async () => {
    process.env.FAKE_UV_FAIL = 'pip';
    const paths = resolvePaths({ MACLAYA_HOME: path.join(dir, 'home') });
    const error = await ensureRuntime({ paths, env: { MACLAYA_UV: path.join(dir, 'uv') } }).catch((e) => e);
    expect(error).toBeInstanceOf(BootstrapError);
    expect(error.message).toContain('No solution found for laya-mlx');
    expect(error.hint).toContain('maclaya doctor');
    expect(existsSync(paths.runtimeMarker)).toBe(false);
  });

  it('asks before installing uv and explains how to get it when declined', async () => {
    const paths = resolvePaths({ MACLAYA_HOME: path.join(dir, 'home') });
    const env = { HOME: dir, PATH: '/usr/bin:/bin' };
    expect(await findUv(paths, env)).toBeUndefined();
    const confirmUvInstall = jest.fn().mockResolvedValue(false);
    const error = await ensureRuntime({ paths, env, confirmUvInstall }).catch((e) => e);
    expect(confirmUvInstall).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(BootstrapError);
    expect(error.hint).toContain('brew install uv');
  });

  it('finds a uv installed into ~/.maclaya/bin', async () => {
    const paths = resolvePaths({ MACLAYA_HOME: dir });
    expect(await findUv({ ...paths, bin: dir }, { HOME: '/nonexistent', PATH: '/usr/bin:/bin' })).toBe(path.join(dir, 'uv'));
  });
});
