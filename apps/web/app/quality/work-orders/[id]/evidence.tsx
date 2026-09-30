'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../labels';
import { viewerKeyAction, type EvidenceFile } from './evidence-model';

/** A file that cannot be loaded shows a quiet placeholder instead of a broken image. */
function Thumb({ file }: { file: EvidenceFile }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="evidence-missing" aria-label="File unavailable">▣</span>;
  return <img src={file.thumbSrc} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function Evidence({ files }: { files: EvidenceFile[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const isOpen = open !== null;
  // Take focus when the viewer opens so Escape and arrows work at once; give it back on close.
  useEffect(() => {
    if (!isOpen) return;
    dialog.current?.focus();
    const button = opener.current;
    return () => button?.focus();
  }, [isOpen]);
  if (files.length === 0) return null;
  const current = open === null ? null : files[open]!;
  const step = (by: number) => setOpen((index) => (index === null ? null : (index + by + files.length) % files.length));

  return (
    <>
      <ul className="evidence" aria-label="Evidence">
        {files.map((file, index) => (
          <li key={file.id}>
            <button type="button" onClick={(e) => { opener.current = e.currentTarget; setOpen(index); }} aria-label={`Open ${file.kind === 'VIDEO' ? 'video' : 'photo'} ${index + 1}`}>
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
        <div className="evidence-viewer" role="dialog" aria-modal="true" aria-label="Evidence viewer" ref={dialog} tabIndex={-1} onKeyDown={(e) => {
          const action = viewerKeyAction(e.key, e.target instanceof HTMLVideoElement);
          if (action === 'close') setOpen(null);
          else if (action === 'next') step(1);
          else if (action === 'previous') step(-1);
        }}>
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
