'use client';

import { useState } from 'react';
import { formatDateTime } from '../labels';
import type { EvidenceFile } from './evidence-model';

/** A file that cannot be loaded shows a quiet placeholder instead of a broken image. */
function Thumb({ file }: { file: EvidenceFile }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="evidence-missing" aria-label="File unavailable">▣</span>;
  return <img src={file.thumbSrc} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function Evidence({ files }: { files: EvidenceFile[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (files.length === 0) return null;
  const current = open === null ? null : files[open]!;
  const step = (by: number) => setOpen((index) => (index === null ? null : (index + by + files.length) % files.length));

  return (
    <>
      <ul className="evidence" aria-label="Evidence">
        {files.map((file, index) => (
          <li key={file.id}>
            <button type="button" onClick={() => setOpen(index)} aria-label={`Open ${file.kind === 'VIDEO' ? 'video' : 'photo'} ${index + 1}`}>
              <Thumb file={file} />
              {file.kind === 'VIDEO' ? <span className="evidence-play" aria-hidden="true">▶</span> : null}
              {file.isNew ? <span className="evidence-new">New</span> : null}
            </button>
            <small>{file.capturedAt ? formatDateTime(file.capturedAt) : 'Time unknown'}</small>
            <small>{file.distanceText}</small>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="evidence-viewer" role="dialog" aria-modal="true" aria-label="Evidence viewer" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }} tabIndex={-1}>
          <div className="evidence-stage">
            {current.kind === 'VIDEO'
              ? <video key={current.id} src={current.originalSrc} poster={current.thumbSrc} controls autoPlay />
              : <img key={current.id} src={current.originalSrc} alt="" />}
          </div>
          <div className="evidence-bar">
            <button type="button" onClick={() => step(-1)} disabled={files.length < 2} aria-label="Previous">‹</button>
            <span>{(open ?? 0) + 1} / {files.length} · {current.distanceText}</span>
            <button type="button" onClick={() => step(1)} disabled={files.length < 2} aria-label="Next">›</button>
            <a className="primary-button" href={current.downloadSrc} download>Download</a>
            <button type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
