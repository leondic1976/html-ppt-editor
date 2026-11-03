import { scanHtmlFile, type ScanReport } from '@hps/security-scan';

const WORKER_TIMEOUT_MS = 45_000;

/**
 * Scan off the main thread. If the worker cannot start, scanning still happens on the main thread:
 * a failed worker must never mean an unscanned file. If the worker hangs it is killed and the
 * result says so, rather than passing the file as clean.
 */
export function scanInWorker(bytes: Uint8Array, fileName: string): Promise<ScanReport> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./scan-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      void scanHtmlFile(bytes, { fileName }).then(resolve);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      void scanHtmlFile(new Uint8Array(0), { fileName }).then((empty) =>
        resolve({
          ...empty,
          verdict: 'suspicious',
          stats: { ...empty.stats, size: bytes.length },
          limits: ['검사가 시간 제한을 넘어 중단되었습니다. 파일 내용을 확인하지 못했습니다.'],
          findings: [
            {
              ruleId: 'scan.timeout',
              severity: 'medium',
              category: 'resource',
              title: '검사를 끝내지 못함',
              detail:
                '파일이 지나치게 크거나 복잡합니다. 내용을 확인하지 못했으므로 신뢰할 수 있는 출처일 때만 여세요.',
              count: 1,
            },
          ],
        }),
      );
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; report?: ScanReport }>) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok && e.data.report) resolve(e.data.report);
      else void scanHtmlFile(bytes, { fileName }).then(resolve);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      void scanHtmlFile(bytes, { fileName }).then(resolve);
    };
    // A copy, so the bytes stay usable here.
    worker.postMessage({ bytes, opts: { fileName } });
  });
}
